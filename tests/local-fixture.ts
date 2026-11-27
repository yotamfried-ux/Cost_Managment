import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { encodeBase32, passwordHash } from "../src/lib/auth";
import { businessDate, monthOffset } from "../src/lib/finance";
import { LedgerRepository } from "../src/lib/repository";
import { applyBatch, batchInput } from "../src/lib/business";

if (!process.env.GITHUB_ENV || process.env.VERCEL) throw new Error("Fixture requires a local environment file");
const root = await mkdtemp(join(tmpdir(), "d2r-e2e-"));
const dataKey = randomBytes(32);
const sessionKey = randomBytes(32).toString("base64url");
const password = randomBytes(20).toString("base64url");
const agentSecret = randomBytes(24).toString("hex");
const publisherSecret = randomBytes(24).toString("hex");
const roles = ["owner", "editor", "viewer"] as const;
const accounts = await Promise.all(roles.map(async role => ({
  email: role + "@d2r.test", role, passwordHash: await passwordHash(password), totpSecret: encodeBase32(randomBytes(20)),
})));
// Dedicated owner and viewer for the approvals test, so their sign-ins never reuse a TOTP code another spec just spent.
accounts.push({ email: "approver@d2r.test", role: "owner", passwordHash: await passwordHash(password), totpSecret: encodeBase32(randomBytes(20)) });
accounts.push({ email: "watcher@d2r.test", role: "viewer", passwordHash: await passwordHash(password), totpSecret: encodeBase32(randomBytes(20)) });
await new LedgerRepository({ mode: "local", root, key: dataKey }).transaction(data => {
  data.business.name = "סביבת בדיקה מבודדת";
  data.projects.push({ id: randomUUID(), name: "פרויקט בדיקה", description: "פרויקט מקומי לבדיקות", status: "active", monthly_budget_minor: 900000 });
  const supplierId = randomUUID();
  data.suppliers.push({ id: supplierId, name: "ספק בדיקה", category: "כלים עסקיים" });
  data.subscriptions.push({ id: randomUUID(), supplier_id: supplierId, label: "מנוי בדיקה חודשי", amount_minor: 2000,
    currency: "USD", cycle: "monthly", status: "active", next_charge_on: null });
  data.usdReferenceRate = { quote: "3.5", quoted: businessDate() };
  const bytes = Buffer.from("%PDF-1.4\nGMAIL FIXTURE\n%%EOF");
  const id = randomUUID();
  data.inboxReceipts = [{ id, sender: "receipt@fixture.test", subject: "Receipt", receivedOn: businessDate(),
    originalName: "gmail-fixture.pdf", digest: createHash("sha256").update(bytes).digest("hex"), messageId: "a", attachmentId: "a" }];
  const supplier = { id: randomUUID(), name: "Hetzner", category: "תשתיות ענן" };
  data.suppliers.push(supplier);
  const invoiceId = randomUUID();
  const invoiceBytes = Buffer.from("%PDF-1.4\nHETZNER FIXTURE\n%%EOF");
  data.invoices.push({ id: invoiceId, supplier_id: supplier.id, invoice_number: "FIX-HETZNER",
    issued_on: monthOffset(businessDate().slice(0, 7), -1) + "-01", currency: "USD", amount_minor: 1000,
    status: "review", sha256: createHash("sha256").update(invoiceBytes).digest("hex"), original_name: "hetzner.pdf" });
  data.gmailRuns = [{ at: new Date().toISOString(), status: "failed", reason: "invalid_grant",
    added: 0, filed: 0, paid: 0, linked: 0, review: null, hasMore: false }];
  const today = businessDate();
  applyBatch(data, batchInput.parse({ batchId: randomUUID(), records: [
    { type: "lead", key: "fix-lead-1", name: "ליד בדיקה", contact: "fixture@d2r.test", source: "instagram", product: "tori", status: "qualified", consent: "inbound", nextAction: "לשלוח הצעה", nextActionDue: monthOffset(today.slice(0, 7), -1) + "-05" },
    { type: "customer", key: "fix-customer-1", name: "לקוח בדיקה", products: ["tori"], status: "active", since: today },
    { type: "post", key: "fix-post-1", platform: "instagram", product: "tori", status: "published", publishedOn: today, url: "https://example.test/p/1", format: "ריל", hook: "פתיח בדיקה" },
    { type: "metric", key: "fix-metric-1", date: today, platform: "instagram", product: "tori", postKey: "fix-post-1", views: 1200, reach: 800, saves: 15, shares: 4, clicks: 9 },
  ] }));
  return { result: true, documents: [{ id, bytes }, { id: invoiceId, bytes: invoiceBytes }] };
});
if (process.env.GITHUB_ACTIONS) {
  for (const secret of [password, dataKey.toString("base64url"), sessionKey, agentSecret, publisherSecret, ...accounts.map(row => row.totpSecret)]) console.log("::add-mask::" + secret);
}
const values = {
  D2R_LOCAL_DATA_DIR: root, D2R_DATA_KEY: dataKey.toString("base64url"), D2R_SESSION_SECRET: sessionKey,
  D2R_AUTH_ACCOUNTS: JSON.stringify(accounts), D2R_TEST_PASSWORD: password,
  D2R_AGENT_SECRET: agentSecret, D2R_PUBLISHER_SECRET: publisherSecret, D2R_SHARED_PASSWORD_HASH: await passwordHash(password),
};
await appendFile(process.env.GITHUB_ENV, Object.entries(values).map(([key,value]) => `${key}=${value}\n`).join(""), { mode: 0o600 });
