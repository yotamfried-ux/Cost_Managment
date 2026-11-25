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
  const form = page.getByRole("form", { name: "כניסה לחשבון אישי" });
  await form.getByLabel("דואר אלקטרוני").fill(role + "@d2r.test");
  await form.getByLabel("סיסמת חשבון").fill(process.env.D2R_TEST_PASSWORD!);
  const account = authConfig()?.accounts.find(row => row.role === role);
  if (!account) throw new Error("Test account unavailable");
  await form.getByLabel("קוד אימות").fill(totp(account.totpSecret));
  await form.getByRole("button", { name: /כניסה/ }).click();
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
  await expect(page.getByText("השינויים נשמרו.")).toBeVisible();
  await page.getByRole("link", { name: "לכל התנועות", exact: true }).click();
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
  await page.goto("/invoices?month=" + month);
  await page.getByRole("link", { name: "בדיקה ותיוק" }).click();
  const booking = page.getByRole("region", { name: "העלאת חשבונית" });
  await expect(booking.getByRole("link", { name: "הורדת PDF מהתיבה" })).toBeVisible();
  await booking.getByLabel("מספר חשבונית").fill("GMAIL-TEST-2");
  await booking.getByRole("combobox", { name: "ספק" }).selectOption({ label: "ספק בדיקה" });
  await booking.getByLabel("תאריך חשבונית").fill(month + "-01");
  await booking.getByLabel("סכום", { exact: true }).fill("25");
  await booking.getByRole("button", { name: "שמירה" }).click();
  await expect(page.getByRole("link", { name: "GMAIL-TEST-2" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "מסמכים מ־Gmail הממתינים לבדיקה" })).toHaveCount(0);
  await page.goto("/expenses?month=" + month);
  await expect(page.getByRole("heading", { name: "סיכום חודשי לפי ספק תשתית" })).toBeVisible();
  await expect(page.getByRole("rowheader", { name: "ספק בדיקה", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /רשימת הוצאות/ })).toHaveCount(0);
  await page.getByRole("row", { name: /ספק בדיקה/ }).getByRole("link", { name: "פירוט חיובים" }).click();
  await expect(page.getByRole("cell", { name: "מאומת", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "חלוקת עלויות", exact: true }).click();
  const allocation = page.getByRole("region", { name: "חלוקת עלויות לפרויקטים" });
  await allocation.getByRole("combobox", { name: "פרויקט 1", exact: true }).selectOption({ label: "פרויקט בדיקה" });
  await allocation.getByRole("spinbutton", { name: "אחוז לפרויקט 1" }).fill("60");
  await allocation.getByRole("button", { name: "שמירה" }).click();
  await expect(page.getByText("השינויים נשמרו.")).toBeVisible();

  for (const [path, heading] of [
    ["projects", "פרויקטים"], ["expenses", "הוצאות"], ["invoices", "חשבוניות"], ["suppliers", "ספקים"],
    ["reports", "דוחות"], ["integrations", "אינטגרציות"], ["settings", "הגדרות"],
  ]) {
    await page.goto("/" + path);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "עלות חודשית לפי פרויקט ותשתית" })).toBeVisible();
  await expect(page.getByRole("rowheader", { name: "ללא שיוך לפרויקט", exact: true })).toBeVisible();
  await page.getByRole("link", { name: /פרויקט בדיקה/ }).first().click();
  await expect(page.getByRole("heading", { name: "פרויקט בדיקה" })).toBeVisible();
  await expect(page.getByRole("row", { name: /ספק בדיקה/ }).getByRole("cell", { name: /74\.07/ })).toHaveCount(2);
  await page.setViewportSize({ width: 1586, height: 992 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "ניהול העסק" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "הוצאות החודש לפי ספק", exact: true })).toBeVisible();
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

test("monthly subscriptions without a renewal date appear on the overview and expenses", async ({ page }) => {
  test.skip(!process.env.D2R_TEST_PASSWORD, "Requires isolated repository fixture");
  await login(page, "owner");
  for (const path of ["/", "/expenses"]) {
    await page.goto(path);
    const panel = page.getByRole("region", { name: "מנויים חודשיים" });
    await expect(panel.getByRole("row").filter({ hasText: "מנוי בדיקה חודשי" })).toContainText(/20\.00/);
    const summary = page.getByRole("region", { name: path === "/" ? "הוצאות החודש לפי ספק" : "סיכום חודשי לפי ספק תשתית" });
    await expect(summary.getByText("מנוי בדיקה חודשי")).toHaveCount(0);
  }
});

test("shared password keeps a remembered browser signed in and grants viewer access", async ({ page, browser }) => {
  test.skip(!process.env.D2R_SHARED_PASSWORD_HASH, "Requires shared access fixture");
  await page.goto("/sign-in");
  const form = page.getByRole("form", { name: "כניסה עם סיסמה משותפת" });
  await expect(form.getByRole("checkbox")).toBeChecked();
  await form.getByLabel("סיסמה").fill("wrong-fixture-password");
  await form.getByRole("button", { name: "כניסה" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "לא ניתן להתחבר" })).toBeVisible();
  await form.getByLabel("סיסמה").fill(process.env.D2R_TEST_PASSWORD!);
  await form.getByRole("button", { name: "כניסה" }).click();
  await expect(page.getByRole("heading", { name: "ניהול העסק" })).toBeVisible();
  await expect(page.getByRole("link", { name: "הוספת הוצאה" })).toHaveCount(0);
  const stored = await page.context().storageState();
  expect(stored.cookies.find(cookie => cookie.name === "d2r_session")?.httpOnly).toBe(true);
  expect(stored.cookies.find(cookie => cookie.name === "d2r_session")?.expires).toBeGreaterThan(Date.now() / 1000 + 29 * 86400);
  const remembered = await browser.newContext({ storageState: stored });
  try {
    const tab = await remembered.newPage();
    await tab.goto(page.url());
    await expect(tab.getByRole("heading", { name: "ניהול העסק" })).toBeVisible();
  } finally {
    await remembered.close();
  }
});
