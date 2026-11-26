import { createHmac, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { authConfig, totp } from "../src/lib/auth";

const signed = (body: string, secret = process.env.D2R_AGENT_SECRET ?? "") => {
  const timestamp = String(Date.now());
  return { "content-type": "application/json", "x-d2r-timestamp": timestamp, "x-d2r-signature": createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex") };
};

test("agent ingest refuses unsigned or wrongly signed requests", async ({ request }) => {
  test.skip(!process.env.D2R_AGENT_SECRET, "Requires isolated repository fixture");
  const body = JSON.stringify({ batchId: randomUUID(), records: [{ type: "run", key: "r1", routine: "daily", summary: "x", at: new Date().toISOString() }] });
  expect((await request.post("/api/agent/ingest", { data: body, headers: { "content-type": "application/json" } })).status()).toBe(401);
  expect((await request.post("/api/agent/ingest", { data: body, headers: signed(body, "f".repeat(48)) })).status()).toBe(401);
  expect((await request.get("/api/agent/ingest")).status()).toBe(405);
});

test("signed batch is stored once and shown in the new screens, which pass accessibility checks", async ({ page, request }) => {
  test.skip(!process.env.D2R_TEST_PASSWORD, "Requires isolated repository fixture");
  const suffix = randomUUID().slice(0, 8);
  const body = JSON.stringify({ batchId: randomUUID(), records: [
    { type: "lead", key: "e2e-lead-" + suffix, name: "ליד מהסוכן " + suffix, source: "facebook", status: "new", consent: "opt_in" },
    { type: "run", key: "e2e-run-" + suffix, routine: "daily-intake", summary: "סיכום ריצת בדיקה", at: new Date().toISOString() },
  ] });
  const first = await request.post("/api/agent/ingest", { data: body, headers: signed(body) });
  expect(first.status()).toBe(200);
  expect(await first.json()).toMatchObject({ duplicate: false, added: 2 });
  const replay = await request.post("/api/agent/ingest", { data: body, headers: signed(body) });
  expect(await replay.json()).toMatchObject({ duplicate: true, added: 0 });

  await page.goto("/sign-in");
  const form = page.getByRole("form", { name: "כניסה לחשבון אישי" });
  await form.getByLabel("דואר אלקטרוני").fill("owner@d2r.test");
  await form.getByLabel("סיסמת חשבון").fill(process.env.D2R_TEST_PASSWORD!);
  await form.getByLabel("קוד אימות").fill(totp(authConfig()!.accounts.find(row => row.role === "owner")!.totpSecret));
  await form.getByRole("button", { name: /כניסה/ }).click();
  await expect(page.getByRole("heading", { name: "ניהול העסק" })).toBeVisible();

  await page.goto("/leads");
  await expect(page.getByRole("heading", { name: "לידים", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "ליד בדיקה" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "ליד מהסוכן " + suffix })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.goto("/customers");
  await expect(page.getByRole("cell", { name: "לקוח בדיקה" })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.goto("/marketing");
  await expect(page.getByRole("link", { name: "פתיח בדיקה" })).toHaveAttribute("href", "https://example.test/p/1");
  await expect(page.getByText("סיכום ריצת בדיקה")).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/leads");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
