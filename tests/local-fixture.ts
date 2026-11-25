import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { encodeBase32, passwordHash } from "../src/lib/auth";
import { businessDate } from "../src/lib/finance";
import { LedgerRepository } from "../src/lib/repository";

if (!process.env.GITHUB_ENV || process.env.VERCEL) throw new Error("Fixture requires a local environment file");
const root = await mkdtemp(join(tmpdir(), "d2r-e2e-"));
const dataKey = randomBytes(32);
const sessionKey = randomBytes(32).toString("base64url");
const password = randomBytes(20).toString("base64url");
const roles = ["owner", "viewer"] as const;
const accounts = await Promise.all(roles.map(async role => ({
  email: role + "@d2r.test", role, passwordHash: await passwordHash(password), totpSecret: encodeBase32(randomBytes(20)),
})));
await new LedgerRepository({ mode: "local", root, key: dataKey }).transaction(data => {
  data.business.name = "סביבת בדיקה מבודדת";
  data.projects.push({ id: randomUUID(), name: "פרויקט בדיקה", description: "פרויקט מקומי לבדיקות", status: "active", monthly_budget_minor: 900000 });
  const supplierId = randomUUID();
  data.suppliers.push({ id: supplierId, name: "ספק בדיקה", category: "כלים עסקיים" });
  data.subscriptions.push({ id: randomUUID(), supplier_id: supplierId, label: "מנוי בדיקה חודשי", amount_minor: 2000,
    currency: "USD", cycle: "monthly", status: "active", next_charge_on: null });
  const bytes = Buffer.from("%PDF-1.4\nGMAIL FIXTURE\n%%EOF");
  const id = randomUUID();
  data.inboxReceipts = [{ id, sender: "receipt@fixture.test", subject: "Receipt", receivedOn: businessDate(),
    originalName: "gmail-fixture.pdf", digest: createHash("sha256").update(bytes).digest("hex"), messageId: "a", attachmentId: "a" }];
  return { result: true, document: { id, bytes } };
});
if (process.env.GITHUB_ACTIONS) {
  for (const secret of [password, dataKey.toString("base64url"), sessionKey, ...accounts.map(row => row.totpSecret)]) console.log("::add-mask::" + secret);
}
const values = {
  D2R_LOCAL_DATA_DIR: root, D2R_DATA_KEY: dataKey.toString("base64url"), D2R_SESSION_SECRET: sessionKey,
  D2R_AUTH_ACCOUNTS: JSON.stringify(accounts), D2R_TEST_PASSWORD: password,
  D2R_SHARED_PASSWORD_HASH: await passwordHash(password),
};
await appendFile(process.env.GITHUB_ENV, Object.entries(values).map(([key,value]) => `${key}=${value}\n`).join(""), { mode: 0o600 });
