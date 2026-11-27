import { createHmac, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { authConfig, totp } from "../src/lib/auth";

const signed = (body: string, secret: string) => {
  const timestamp = String(Date.now());
  return { "content-type": "application/json", "x-d2r-timestamp": timestamp, "x-d2r-signature": createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex") };
};
const agent = () => process.env.D2R_AGENT_SECRET ?? "";
const publisher = () => process.env.D2R_PUBLISHER_SECRET ?? "";

async function login(page: Page, email: string) {
  await page.goto("/sign-in");
  const form = page.getByRole("form", { name: "כניסה לחשבון אישי" });
  await form.getByLabel("דואר אלקטרוני").fill(email);
  await form.getByLabel("סיסמת חשבון").fill(process.env.D2R_TEST_PASSWORD!);
  await form.getByLabel("קוד אימות").fill(totp(authConfig()!.accounts.find(row => row.email === email)!.totpSecret));
  await form.getByRole("button", { name: /כניסה/ }).click();
  await expect(page.getByRole("heading", { name: "ניהול העסק" })).toBeVisible();
}

test("queue refuses requests signed with the agent secret, and the agent cannot approve its own post", async ({ request }) => {
  test.skip(!process.env.D2R_PUBLISHER_SECRET, "Requires isolated repository fixture");
  const claim = JSON.stringify({ action: "claim" });
  expect((await request.post("/api/agent/queue", { data: claim, headers: { "content-type": "application/json" } })).status()).toBe(401);
  expect((await request.post("/api/agent/queue", { data: claim, headers: signed(claim, agent()) })).status()).toBe(401);
  expect((await request.get("/api/agent/queue")).status()).toBe(405);
  const approve = JSON.stringify({ batchId: randomUUID(), records: [{ type: "publication", key: "bad-" + randomUUID().slice(0, 8), status: "approved", platforms: ["instagram"], publishAt: new Date(Date.now() + 3_600_000).toISOString(), captionIg: "x", fileUrl: "https://raw.githubusercontent.com/yotamfried-ux/Director/media-assets/a.mp4", fileName: "a.mp4" }] });
  expect((await request.post("/api/agent/ingest", { data: approve, headers: signed(approve, agent()) })).status()).toBe(400);
  const publish = JSON.stringify({ batchId: randomUUID(), records: [{ type: "lead", key: "x", name: "x", source: "x", status: "new", consent: "none" }] });
  expect((await request.post("/api/agent/ingest", { data: publish, headers: signed(publish, publisher()) })).status()).toBe(401);
});

test("owner approves a proposed post; only then does the publisher receive it, once, and the result is shown", async ({ page, request, browser }) => {
  test.skip(!process.env.D2R_TEST_PASSWORD, "Requires isolated repository fixture");
  const suffix = randomUUID().slice(0, 8);
  const key = "e2e-pub-" + suffix;
  const caption = "טקסט בדיקה לאישור " + suffix;
  const proposal = JSON.stringify({ batchId: randomUUID(), records: [
    { type: "agent", key: "marketing", name: "סוכן השיווק", job: "מכין פוסטים", cadence: "כל יום", status: "active" },
    { type: "run", key: "e2e-run-" + suffix, agent: "marketing", routine: "daily", summary: "הוכנו פוסטים לבדיקה " + suffix, at: new Date().toISOString() },
    { type: "publication", key, platforms: ["instagram", "facebook"], product: "tori", slot: "A", publishAt: new Date(Date.now() + 6_000).toISOString(), captionIg: caption, captionFb: "פייסבוק " + suffix, fileUrl: "https://raw.githubusercontent.com/yotamfried-ux/Director/media-assets/e2e.mp4", fileName: "e2e.mp4", hook: "פתיח " + suffix },
  ] });
  expect((await request.post("/api/agent/ingest", { data: proposal, headers: signed(proposal, agent()) })).status()).toBe(200);

  // Pending and not yet approved: the publisher gets nothing.
  const claim = JSON.stringify({ action: "claim" });
  expect(await (await request.post("/api/agent/queue", { data: claim, headers: signed(claim, publisher()) })).json()).toEqual({ item: null });

  // A viewer sees the queue but has no approval controls.
  const viewerPage = await (await browser.newContext({ baseURL: "http://localhost:3150" })).newPage();
  await login(viewerPage, "watcher@d2r.test");
  await viewerPage.goto("/approvals");
  await expect(viewerPage.getByText(caption)).toBeVisible();
  await expect(viewerPage.getByRole("button", { name: /אישור/ })).toHaveCount(0);
  await viewerPage.context().close();

  await login(page, "approver@d2r.test");
  await page.goto("/approvals");
  await expect(page.getByRole("heading", { name: "אישורים", exact: true })).toBeVisible();
  await expect(page.getByText(caption)).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  const card = page.getByRole("article", { name: "פוסט פתיח " + suffix });
  await card.getByRole("button", { name: "אישור הפוסט" }).click();
  await expect(page.getByRole("status").filter({ hasText: "אושרו או נדחו 1 פוסטים" })).toBeVisible();
  await expect(card.getByText("מאושר", { exact: true })).toBeVisible();
  await expect(card.getByText(/אושר על ידי approver@d2r.test/)).toBeVisible();

  // The slot arrives: the publisher receives exactly this post, once.
  await expect.poll(async () => (await (await request.post("/api/agent/queue", { data: claim, headers: signed(claim, publisher()) })).json()).item?.key, { timeout: 20_000, intervals: [1_000] }).toBe(key);
  expect(await (await request.post("/api/agent/queue", { data: claim, headers: signed(claim, publisher()) })).json()).toEqual({ item: null });
  const report = JSON.stringify({ action: "report", key, outcome: "published", igMediaId: "17900000000000001", fbPostId: "1401748436362661_1", note: "" });
  expect((await request.post("/api/agent/queue", { data: report, headers: signed(report, publisher()) })).status()).toBe(200);
  expect((await request.post("/api/agent/queue", { data: report, headers: signed(report, publisher()) })).status()).toBe(409);

  await page.goto("/approvals");
  await expect(page.getByRole("row", { name: new RegExp("פתיח " + suffix) }).getByText("פורסם")).toBeVisible();
  await page.goto("/agents");
  await expect(page.getByRole("heading", { name: "סוכנים", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "סוכן השיווק" }).first()).toBeVisible();
  await expect(page.getByText("הוכנו פוסטים לבדיקה " + suffix).first()).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/approvals");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
