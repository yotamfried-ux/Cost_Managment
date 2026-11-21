import { authConfig, totp } from "../src/lib/auth";
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

async function login(page: Page, role: "owner" | "viewer") {
  await page.goto("/sign-in");
  await page.getByLabel("דואר אלקטרוני").fill(role + "@d2r.test");
  await page.getByLabel("סיסמה").fill(process.env.D2R_TEST_PASSWORD!);
  const account = authConfig()?.accounts.find(row => row.role === role);
  if (!account) throw new Error("Test account unavailable");
  await page.getByLabel("קוד אימות").fill(totp(account.totpSecret));
  await page.getByRole("button", { name: "כניסה", exact: true }).click();
  await expect(page.getByRole("heading", { name: "ניהול העסק" })).toBeVisible();
}

test("owner enters workspace, adds a real ledger entry, exports, and navigates every screen", async ({ page }, testInfo) => {
  test.skip(!process.env.D2R_TEST_PASSWORD, "Requires isolated repository fixture");
  await login(page, "owner");
  await page.getByRole("link", { name: "הוספת הוצאה" }).click();
  await page.getByLabel("תיאור", { exact: true }).fill("בדיקת הוצאה מקומית");
  await page.getByLabel("סכום", { exact: true }).fill("123.45");
  await page.getByRole("combobox", { name: "ספק", exact: true }).selectOption({ label: "ספק בדיקה" });
  await page.getByRole("button", { name: "שמירה", exact: true }).click();
  await expect(page.getByText("בדיקת הוצאה מקומית")).toBeVisible();
  const month = new URL(page.url()).searchParams.get("month");
  const csv = await page.request.get("/api/export?month=" + month);
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain("בדיקת הוצאה מקומית");

  await page.goto("/invoices?add=invoice&month=" + month);
  await page.getByLabel("מספר חשבונית", { exact: true }).fill("FIX-100");
  await page.getByRole("region", { name: "העלאת חשבונית" }).getByRole("combobox", { name: "ספק", exact: true }).selectOption({ label: "ספק בדיקה" });
  await page.getByLabel("תאריך חשבונית").fill(month + "-01");
  await page.getByLabel("סכום", { exact: true }).fill("123.45");
  const pdf = Buffer.from("%PDF-1.4\nPRIVATE FIXTURE\n%%EOF");
  await page.locator('input[type="file"]').setInputFiles({ name: "fixture.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.getByRole("button", { name: "שמירה", exact: true }).click();
  await page.getByRole("link", { name: "FIX-100" }).click();
  const download = await page.getByRole("link", { name: "הורדת PDF מקורי" }).getAttribute("href");
  const file = await page.request.get(download!);
  expect(file.status()).toBe(200);
  expect(await file.body()).toEqual(pdf);
  await page.getByRole("button", { name: "אישור התאמה" }).click();
  await expect(page.getByText("השינויים נשמרו.")).toBeVisible();
  await page.goto("/expenses?month=" + month);
  await expect(page.getByRole("cell", { name: "מאומת", exact: true })).toBeVisible();

  for (const [path, heading] of [
    ["projects", "פרויקטים"], ["expenses", "הוצאות"], ["invoices", "חשבוניות"], ["suppliers", "ספקים"],
    ["reports", "דוחות"], ["integrations", "אינטגרציות"], ["settings", "הגדרות"],
  ]) {
    await page.goto("/" + path);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
  await page.goto("/projects");
  await page.getByRole("link", { name: /פרויקט בדיקה/ }).first().click();
  await expect(page.getByRole("heading", { name: "פרויקט בדיקה" })).toBeVisible();
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
  test.skip(!process.env.D2R_TEST_PASSWORD, "Requires isolated repository fixture");
  await login(page, "viewer");
  await expect(page.getByRole("link", { name: "הוספת הוצאה" })).toHaveCount(0);
  await page.goto("/expenses?add=expense");
  await expect(page.getByRole("heading", { name: "הוספת הוצאה" })).toHaveCount(0);
});
