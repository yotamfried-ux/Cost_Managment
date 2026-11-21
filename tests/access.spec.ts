import { createHmac } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";

test("unauthenticated visits redirect, finance APIs refuse access and security headers apply", async ({ page, request }) => {
  const response = await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { name: "כניסה לסביבת העבודה" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  expect(response?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(response?.headers()["cache-control"]).toContain("no-store");
  expect((await request.get("/api/export")).status()).toBe(401);
  expect((await request.get("/api/documents/79d68b91-ff01-488b-b6da-afbdc36dcaaa")).status()).toBe(401);
  expect((await request.get("/api/health")).status()).toBe(200);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
});

function totp(secret: string) {
  const base32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bitString = "";
  for (const character of secret.replace(/=+$/, "")) bitString += base32.indexOf(character).toString(2).padStart(5, "0");
  const buffer = Buffer.from(bitString.match(/.{8}/g)!.map(bits => parseInt(bits, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const full = createHmac("sha1", buffer).update(counter).digest();
  return String((full.readUInt32BE(full[full.length - 1] & 0xf) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function login(page: Page, role: "owner" | "viewer") {
  await page.goto("/sign-in");
  await page.getByLabel("דואר אלקטרוני").fill(role + "@d2r.test");
  await page.getByLabel("סיסמה").fill(process.env.D2R_TEST_PASSWORD!);
  await page.getByRole("button", { name: "כניסה", exact: true }).click();
  await expect(page).toHaveURL(/\/mfa$/);
  await page.getByRole("button", { name: "הגדרת יישום אימות" }).click();
  const secret = page.locator(".mfa-key");
  await expect(secret).toBeVisible();
  await page.getByLabel("קוד בן 6 ספרות").fill(totp((await secret.innerText()).trim()));
  await page.getByRole("button", { name: "אימות", exact: true }).click();
  await expect(page.getByRole("heading", { name: "ניהול העסק" })).toBeVisible();
}

test("owner enters workspace, adds a real ledger entry, exports, and navigates every screen", async ({ page }, testInfo) => {
  test.skip(!process.env.D2R_TEST_PASSWORD, "Requires isolated Supabase fixture");
  await login(page, "owner");
  await page.getByRole("link", { name: "הוספת הוצאה" }).click();
  await page.getByLabel("תיאור", { exact: true }).fill("בדיקת הוצאה מקומית");
  await page.getByLabel("סכום", { exact: true }).fill("123.45");
  await page.getByRole("button", { name: "שמירה", exact: true }).click();
  await expect(page.getByText("בדיקת הוצאה מקומית")).toBeVisible();
  const month = new URL(page.url()).searchParams.get("month");
  const csv = await page.request.get("/api/export?month=" + month);
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain("בדיקת הוצאה מקומית");

  for (const [path, heading] of [
    ["projects", "פרויקטים"], ["expenses", "הוצאות"], ["invoices", "חשבוניות"], ["suppliers", "ספקים"],
    ["reports", "דוחות"], ["integrations", "אינטגרציות"], ["settings", "הגדרות"],
  ]) {
    await page.goto("/" + path);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
  await page.setViewportSize({ width: 1586, height: 992 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "ניהול העסק" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("dashboard-desktop.png"), fullPage: true });
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("navigation", { name: "ניווט ראשי" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: testInfo.outputPath("dashboard-mobile.png"), fullPage: true });
});

test("isolated viewer can read the workspace and cannot start expense creation", async ({ page }) => {
  test.skip(!process.env.D2R_TEST_PASSWORD, "Requires isolated Supabase fixture");
  await login(page, "viewer");
  await expect(page.getByRole("link", { name: "הוספת הוצאה" })).toHaveCount(0);
  await page.goto("/expenses?add=expense");
  await expect(page.getByRole("heading", { name: "הוספת הוצאה" })).toHaveCount(0);
});
