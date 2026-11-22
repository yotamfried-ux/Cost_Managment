import assert from "node:assert/strict";
import { test } from "node:test";
import { businessDate, minorUnits, monthOffset, resolveMonth, safeCsv } from "../src/lib/finance";
import { PaymentsDisabled, ProviderRegistry, receiveVerifiedEvent, reconcilePayment } from "../src/lib/plugins";
import { vercelConnector } from "../src/lib/vercel-billing";
import { anthropicConnector, githubConnector, openAiConnector } from "../src/lib/connectors";

test("Jerusalem month coverage and currency minor units", () => {
  assert.equal(businessDate(new Date("2026-03-31T22:00:00Z")), "2026-04-01");
  assert.equal(monthOffset("2026-01", -1), "2025-12");
  assert.notEqual(resolveMonth("2026-13"), "2026-13");
  assert.equal(minorUnits("18.90", "ILS"), 1890);
  assert.equal(minorUnits("18", "JPY"), 18);
  assert.throws(() => minorUnits("18.9", "JPY"));
});

test("CSV neutralizes formulas and escapes values", () => {
  assert.equal(safeCsv([[" =SUM(A1)", 'a,"b"', -17, null, "\tspreadsheet"]]), '\uFEFF"\' =SUM(A1)","a,""b""","-17","","\'\tspreadsheet"');
});

test("disabled plugin cannot act and rejects before writing webhook inbox", async () => {
  const registry = new ProviderRegistry();
  await assert.rejects(registry.payment("Grow").createCheckout({ orderId: "1", idempotencyKey: "key", money: { minor: 10, currency: "ILS" } }), PaymentsDisabled);
  await assert.rejects(registry.invoice("SUMIT").issueDocument({ paymentId: "1", customerId: "2", idempotencyKey: "key", money: { minor: 10, currency: "ILS" } }), PaymentsDisabled);
  await assert.rejects(receiveVerifiedEvent({ async enqueueOnce() { assert.fail("Unverified event reached the inbox"); } }, "org", "payment", registry.payment(), new Uint8Array(), new Headers()), PaymentsDisabled);
  assert.equal(reconcilePayment({ minor: 300, currency: "ILS" }, { minor: 300, currency: "USD" }), "REVIEW_REQUIRED");
  assert.equal(reconcilePayment({ minor: 300, currency: "ILS" }, { minor: 300, currency: "ILS" }), "MATCHED");
});

test("provider connectors preserve source accounting units and stable keys", async (t) => {
  const time = Date.parse("2026-11-01T00:00:00Z") / 1000;
  t.mock.method(globalThis, "fetch", async (url: URL) => {
    assert.equal(url.searchParams.get("start_time"), String(time));
    return Response.json({ data: [{ start_time: time, end_time: time + 86400, results: [{ amount: { value: "1.25", currency: "usd" } }] }], has_more: false });
  });
  const event = await openAiConnector("fixture").syncCosts({ start: "2026-11-01", end: "2026-12-01", account: "fixture" });
  assert.deepEqual(event, [{ start: "2026-11-01", end: "2026-11-02", key: "2026-11-01:2026-11-02:USD", label: "OpenAI API", minor: 125, currency: "USD" }]);
});

test("Anthropic already reports cents and never appears as a personal plan fee", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ data: [{
    starting_at: "2026-11-01T00:00:00Z", ending_at: "2026-11-02T00:00:00Z",
    results: [{ amount: "129.5", currency: "USD" }],
  }], has_more: false }));
  const rows = await anthropicConnector("fixture").syncCosts({ start: "2026-11-01", end: "2026-12-01", account: "fixture" });
  assert.equal(rows[0].minor, 130);
  assert.equal(rows[0].label, "Anthropic API");
});

test("GitHub usage with zero net cost is not converted into gross charges", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ usageItems: [
    { date: "2026-11-01", netAmount: 0, grossAmount: 40 },
    { date: "2026-11-02", netAmount: 1.5 },
    { date: "2026-12-01", netAmount: 80 },
  ] }));
  const rows = await githubConnector("fixture").syncCosts({ start: "2026-11-01", end: "2026-12-01", account: "fixture" });
  assert.deepEqual(rows.map(row => row.minor), [0, 150]);
});

test("Vercel uses billed cost from the complete billing export for the requested team", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response([
    JSON.stringify({ BilledCost: 0.125, EffectiveCost: 8, BillingCurrency: "USD", ChargePeriodEnd: "2026-11-19T08:00:00Z", SubAccountId: "team_fixture" }),
    JSON.stringify({ BilledCost: "-0.025", EffectiveCost: 0, BillingCurrency: "USD", ChargePeriodEnd: "2026-11-19T08:00:00Z", SubAccountId: "team_fixture" }),
  ].join("\n"), { headers: { "Content-Type": "application/jsonl" } }));
  const rows = await vercelConnector("fixture").syncCosts({ start: "2026-11-19", end: "2026-11-20", account: "team_fixture" });
  assert.equal(rows[0].minor, 10);
  assert.equal(rows[0].start, "2026-11-19");
});

test("Gmail receipt intake requires allowlisted sender and matching Gmail DKIM", async () => {
  const { alignedSender } = await import("../src/lib/gmail-receipts");
  const senders = [{ email: "receipts@vendor.test", dkim: "vendor.test" }];
  const from = { name: "From", value: "Vendor Receipts <receipts@vendor.test>" };
  const check = (value: string) => alignedSender([from,{name:"Authentication-Results",value}],senders);
  assert.equal(check("mx.google.com; dkim=pass header.i=@vendor.test header.s=mail; spf=pass"), "receipts@vendor.test");
  assert.equal(check("mx.google.com; dkim=pass header.i=@vendor.test.bad; spf=pass"), undefined);
  assert.equal(check("evil.example; dkim=pass header.i=@vendor.test; spf=pass"), undefined);
  assert.equal(check("mx.google.com; dkim=fail header.i=@vendor.test; spf=pass"), undefined);
});

test("project allocations preserve cents, partial allocations and credits", async () => {
  const { splitAmount } = await import("../src/lib/allocation");
  const shares = [{ projectId: "a", basisPoints: 3333 }, { projectId: "b", basisPoints: 5000 }];
  const positive = splitAmount(100, shares);
  const credit = splitAmount(-101, shares);
  assert.equal(positive.get(""), 17);
  assert.equal([...positive.values()].reduce((a,b) => a+b,0), 100);
  assert.equal([...credit.values()].reduce((a,b) => a+b,0), -101);
  assert.throws(() => splitAmount(99,[{projectId:"a",basisPoints:10001}]));
});

test("Gmail diagnostics retain known error codes and omit credential-bearing details", async () => {
  const { GmailImportError } = await import("../src/lib/gmail-receipts");
  const failure = GmailImportError.from("oauth", { response: { status: 400, data: { error: "invalid_grant", error_description: "private data" } } });
  assert.equal(failure.stage, "oauth");
  assert.equal(failure.code, "invalid_grant");
  assert.equal(failure.status, 400);
  assert.equal(JSON.stringify(failure).includes("private data"), false);
  assert.equal(GmailImportError.from("oauth", { response: { status: 400, data: { error: "unknown sensitive text" } } }).code, undefined);
});

test("Gmail accepts PDF-named binary attachments but verifies the actual file format", async () => {
  const { isPdfAttachment } = await import("../src/lib/gmail-receipts");
  const { validPdf } = await import("../src/lib/documents");
  const file = { filename: "invoice.PDF", mimeType: "application/octet-stream", body: { size: 900, attachmentId: "fixture" } };
  assert.equal(isPdfAttachment(file), true);
  assert.equal(isPdfAttachment({ ...file, filename: "invoice.exe" }), false);
  assert.equal(isPdfAttachment({ ...file, mimeType: "text/html" }), false);
  assert.equal(isPdfAttachment({ ...file, body: { size: 5 * 1024 * 1024 } }), false);
  assert.equal(validPdf(Buffer.from("<html>not a PDF</html>")), false);
  assert.equal(validPdf(Buffer.from("%PDF-1.5\nfixture\n%%EOF")), true);
});

test("Gmail original-email import requires explicit sender opt-in and a receipt subject", async () => {
  const { isReceiptEmail } = await import("../src/lib/gmail-receipts");
  const allowed = [{email:"receipt@example.com",dkim:"example.com",emailReceipt:true},{email:"billing@example.com",dkim:"example.com"}];
  assert.equal(isReceiptEmail("receipt@example.com","Your receipt from Example",allowed),true);
  assert.equal(isReceiptEmail("receipt@example.com","Account activity",allowed),false);
  assert.equal(isReceiptEmail("billing@example.com","Your receipt",allowed),false);
  assert.equal(isReceiptEmail("other@example.com","Your receipt",allowed),false);
  const openRouter = [...allowed, { email: "receipts@openrouter.ai", dkim: "openrouter.ai", emailReceipt: true }];
  assert.equal(isReceiptEmail("receipts@openrouter.ai","Your OpenRouter, Inc receipt [123-45]",openRouter),true);
  assert.equal(isReceiptEmail("receipt@example.com","Your OpenRouter, Inc receipt [123-45]",openRouter),false);
});
