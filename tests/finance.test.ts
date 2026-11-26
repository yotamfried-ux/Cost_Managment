import assert from "node:assert/strict";
import { test } from "node:test";
import { businessDate, minorUnits, monthOffset, resolveMonth, safeCsv } from "../src/lib/finance";
import { PaymentsDisabled, ProviderRegistry, receiveVerifiedEvent, reconcilePayment } from "../src/lib/plugins";
import { vercelConnector } from "../src/lib/vercel-billing";
import { anthropicConnector, githubConnector, openAiConnector } from "../src/lib/connectors";
import { costBreakdown } from "../src/lib/cost-breakdown";
import { actualStatus, allCharges, unassigned, type Access } from "../src/lib/queries";
import { emptyData, type Charge } from "../src/lib/repository";
import { fillReferenceRates, referenceRates } from "../src/lib/reference-rates";
import { applyPaymentDocument, parsePaymentText, readPaymentDocument } from "../src/lib/payment-documents";
import { nextGmailPage } from "../src/lib/gmail-receipts";
import { ingestCost, registerVercelBilling } from "../src/lib/ledger";
import { googleBillingConnector } from "../src/lib/google-billing";
import { monthlyManualCharges } from "../src/lib/monthly-charges";
import { reportCharges } from "../src/lib/report-charges";
import { JWT } from "google-auth-library";

test("Jerusalem month coverage and currency minor units", () => {
  assert.equal(businessDate(new Date("2026-03-31T22:00:00Z")), "2026-04-01");
  assert.equal(monthOffset("2026-01", -1), "2025-12");
  assert.notEqual(resolveMonth("2026-13"), "2026-13");
  assert.equal(minorUnits("18.90", "ILS"), 1890);
  assert.equal(minorUnits("18", "JPY"), 18);
  assert.throws(() => minorUnits("18.9", "JPY"));
});

test("manual monthly charges are included once and replaced by matching supplier data", () => {
  const data = emptyData();
  data.usdReferenceRate = { quote: "3.625", quoted: "2026-11-23" };
  const month = "2026-11";
  const today = month + "-25";
  data.subscriptions.push(
    { id: "1", supplier_id: "openai", label: "ChatGPT Plus · אומדן חודשי", currency: "USD", amount_minor: 2000,
      status: "active", cycle: "monthly", next_charge_on: null, starts_on: today },
    { id: "2", supplier_id: "google", label: "Google AI Pro · אומדן חודשי", currency: "ILS", amount_minor: 7490,
      status: "active", cycle: "monthly", next_charge_on: null, starts_on: today },
    { id: "3", supplier_id: "claude", label: "Claude Pro · אומדן חודשי", currency: "USD", amount_minor: 2000,
      status: "active", cycle: "monthly", next_charge_on: null, starts_on: today },
  );
  const charge: Charge = {
    id: "receipt", description: "Google AI Pro · INVOICE-1", recorded_on: month + "-10", amount_minor: 7890,
    currency: "ILS", evidence: "verified", amount_ils_minor: 7890, supplier_id: "google", category: "AI",
    source: "receipt", request_id: "receipt", project_id: null, invoice_id: "receipt",
  };
  data.charges.push(charge, { ...charge, id: "vercel", description: "Vercel", supplier_id: "vercel",
    amount_minor: 10000, amount_ils_minor: 10000, evidence: "provider" });
  const rows = () => monthlyManualCharges(data, month, "2026-12", today);
  assert.deepEqual(rows().map(row => [row.supplier_id, row.amount_ils_minor]), [["openai", 7250], ["claude", 7250]]);
  assert.deepEqual(monthlyManualCharges(data, "2026-10", month, today), []);
  assert.deepEqual(monthlyManualCharges(data, "2026-12", "2027-01", today), []);
  data.charges.push({ ...charge, id: "claude", supplier_id: "claude", description: "Receipt 3",
    currency: "USD", amount_minor: 2000, amount_ils_minor: 7300 });
  assert.deepEqual(rows().map(row => [row.supplier_id, row.amount_ils_minor]), [["openai", 7250]]);
  delete data.usdReferenceRate;
  assert.deepEqual(rows().map(row => [row.amount_minor, row.amount_ils_minor]), [[2000, null]]);
});

test("CSV neutralizes formulas and escapes values", () => {
  assert.equal(safeCsv([[" =SUM(A1)", 'a,"b"', -17, null, "\tspreadsheet"]]), '\uFEFF"\' =SUM(A1)","a,""b""","-17","","\'\tspreadsheet"');
});

test("Gmail keeps a page cursor until every message is settled", () => {
  const page = { ids: ["seen", "unprocessed"], cursor: "previous", next: "next" };
  assert.equal(nextGmailPage(page, new Set(["seen"])), "previous");
  assert.equal(nextGmailPage(page, new Set(["seen", "unprocessed"])), "next");
  assert.equal(nextGmailPage({ ...page, next: undefined }, new Set(["seen", "unprocessed"])), undefined);
});

test("provider revisions can restore an earlier total without adding a second charge", () => {
  const data = emptyData();
  registerVercelBilling(data, "team_fixture");
  const input = { key: "fixture", start: "2026-11-01", end: "2026-11-02", label: "Vercel", currency: "USD", minor: 100 };
  const id = data.accounts[0].id;
  assert.equal(ingestCost(data, id, input), true);
  assert.equal(ingestCost(data, id, { ...input, minor: 200 }), true);
  assert.equal(ingestCost(data, id, input), true);
  assert.equal(ingestCost(data, id, input), false);
  assert.equal(data.charges.length, 1);
  assert.equal(data.charges[0].amount_minor, 100);
  assert.equal(data.costEvents.length, 3);
});

test("Gemini billing waits for a BigQuery job and reads its remaining pages", async t => {
  t.mock.method(JWT.prototype, "getAccessToken", async () => ({ token: "fixture" }));
  const jobReference = { jobId: "fixture_job", location: "us-central1" };
  const row = (date: string, cost: string) => ({ f: [{ v: date }, { v: "USD" }, { v: cost }] });
  const replies = [
    { jobComplete: false, jobReference },
    { jobComplete: true, pageToken: "next", rows: [row("2026-11-01", "1.25")] },
    { jobComplete: true, rows: [row("2026-11-02", "-0.25")] },
  ];
  const requests: URL[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    requests.push(new URL(url));
    if (options.method === "POST") assert.equal(JSON.parse(String(options.body)).maximumBytesBilled, "500000000");
    return Response.json(replies.shift());
  });
  const connector = googleBillingConnector({
    project: "fixture-project", table: "fixture-project.billing.cost", location: "us-central1", skus: ["AAAA-BBBB-CCCC"],
    credentials: { client_email: "service@example.com", private_key: "fixture" }, maximumBytes: "500000000",
  });
  const costs = await connector.syncCosts({ start: "2026-11-01", end: "2026-11-03", account: "tracked-project" });
  assert.deepEqual(costs.map(cost => cost.minor), [125, -25]);
  assert.equal(requests[1].pathname.endsWith("/fixture_job"), true);
  assert.equal(requests[2].searchParams.get("pageToken"), "next");
});

test("Bank of Israel rates use the latest published day, preserve existing conversions, and are idempotent", async t => {
  t.mock.method(globalThis, "fetch", async (url: URL) => {
    assert.equal(url.hostname, "edge.boi.gov.il");
    assert.equal(url.searchParams.get("startPeriod"), "2026-11-01");
    return new Response([
      "SERIES_CODE,FREQ,BASE_CURRENCY,COUNTER_CURRENCY,UNIT_MEASURE,DATA_TYPE,DATA_SOURCE,TIME_COLLECT,CONF_STATUS,PUB_WEBSITE,UNIT_MULT,COMMENTS,TIME_PERIOD,OBS_VALUE,RELEASE_STATUS",
      "RER_USD_ILS,D,USD,ILS,ILS,OF00,BOI_MRKT,V,F,Y,0,,2026-11-06,3.194,YP",
      "RER_USD_ILS,D,USD,ILS,ILS,OF00,BOI_MRKT,V,F,Y,0,,2026-11-09,3.171,YP",
    ].join("\n"), { headers: { "content-type": "text/csv" } });
  });
  const rates = await referenceRates([{ currency: "USD", date: "2026-11-08" }, { currency: "USD", date: "2026-11-09" }]);
  const data = emptyData();
  const original: Charge = {
    id: "usd", description: "provider charge", recorded_on: "2026-11-08", amount_minor: 100, currency: "USD",
    amount_ils_minor: null, evidence: "provider", supplier_id: null, category: "cloud", project_id: null,
    source: "provider", request_id: "fixture", invoice_id: null,
  };
  const manual = { ...original, id: "manual", amount_ils_minor: 340, exchange_rate: { quote: "3.4", date: "2026-11-06", source: "manual" } };
  const estimate = { ...original, id: "estimate", evidence: "estimate" as const };
  data.charges.push(original, manual, estimate);
  assert.equal(fillReferenceRates(data, rates, "2026-11-01", "2026-11-22"), 1);
  assert.equal(original.amount_minor, 100);
  assert.equal(original.amount_ils_minor, 319);
  assert.equal(original.exchange_rate?.date, "2026-11-06");
  assert.equal(manual.amount_ils_minor, 340);
  assert.equal(estimate.amount_ils_minor, null);
  assert.equal(fillReferenceRates(data, rates, "2026-11-01", "2026-11-22"), 0);
});

test("Gmail pairs invoice and paid receipt once, and Vercel never creates a second provider charge", () => {
  const data = emptyData();
  const doc = (id: string, domain: string) => ({
    id, sender: "billing@" + domain, originalName: "receipt.pdf", subject: "Receipt",
    receivedOn: "2026-11-10", digest: id, messageId: id, attachmentId: id,
  });
  const first = doc("invoice", "supabase.com");
  const second = doc("receipt", "supabase.com");
  const billed = parsePaymentText("supabase.com", "INVOICE Invoice number DEMO-0123 Invoice date Nov 9, 2026 Amount due $12.30")!;
  const paid = parsePaymentText("supabase.com", "RECEIPT Invoice number DEMO-0123 Payment date Nov 10, 2026 Amount paid $12.30")!;
  assert.equal(applyPaymentDocument(data, second, paid).paid, 0);
  assert.equal(applyPaymentDocument(data, first, billed).filed, 1);
  assert.equal(applyPaymentDocument(data, second, { ...paid, minor: 999 }).paid, 0);
  assert.deepEqual(applyPaymentDocument(data, second, paid), { filed: 0, paid: 1, linked: 1 });
  assert.deepEqual(applyPaymentDocument(data, second, paid), { filed: 0, paid: 0, linked: 0 });
  assert.equal(data.charges[0].recorded_on, "2026-11-10");
  assert.equal(data.charges[0].invoice_id, first.id);
  assert.equal(data.invoices[0].status, "matched");
  const vercel = parsePaymentText("vercel.com",
    "Page 1 of 1 Invoice Invoice number DEMO-0004 Date of issue Nov 9, 2026 Vercel Inc Amount due $20.00 USD")!;
  assert.equal(applyPaymentDocument(data, doc("vercel-invoice", "vercel.com"), vercel).filed, 1);
  const result = applyPaymentDocument(data, doc("vercel-receipt", "vercel.com"), { ...vercel, kind: "receipt" });
  assert.equal(result.linked, 1);
  assert.equal(data.charges.length, 1);
});

test("Namecheap records only authenticated receipt content with matching order, charge and total", async () => {
  const subject = "Namecheap Order Summary (Order# 123456789);";
  const text = "Order Date : Nov 21, 2026 05:16:59 AM Order Number : 123456789 Transaction ID : 987654321 " +
    "Initial Charge : $15.25 Final Cost : $15.25 Total Refund : N/A Approval # : ch_fixture";
  assert.equal(parsePaymentText("namecheap.com", text.replace("Final Cost : $15.25","Final Cost : $13.25"), subject), undefined);
  assert.equal(parsePaymentText("namecheap.com", text.replace("Total Refund : N/A","Total Refund : $1.00"), subject), undefined);
  const source = {
    id: "order", sender: "support@namecheap.com", subject, receivedOn: "2026-11-21", originalName: "receipt.eml",
    digest: "order", messageId: "order", attachmentId: "original-email", format: "eml" as const,
  };
  const mime = Buffer.from("From: support@namecheap.com\r\nSubject: " + subject + "\r\nContent-Type: text/plain\r\n\r\n" + text);
  const parsed = await readPaymentDocument(source, mime);
  assert.equal(parsed?.minor, 1525);
  const data = emptyData();
  assert.deepEqual(applyPaymentDocument(data, source, parsed!), { filed: 1, paid: 1, linked: 0 });
  assert.deepEqual(applyPaymentDocument(data, source, parsed!), { filed: 0, paid: 0, linked: 0 });
});

test("supplier and project totals preserve currencies, partial assignments, credits and missing FX", () => {
  const data = emptyData();
  const supplier = "10000000-0000-4000-8000-000000000001";
  const project = "20000000-0000-4000-8000-000000000001";
  data.suppliers.push({ id: supplier, name: "Infrastructure", category: "cloud" });
  const base: Charge = {
    id: "usd", description: "daily cost", recorded_on: "2026-11-10", amount_minor: 101, currency: "USD",
    amount_ils_minor: null, evidence: "provider", supplier_id: supplier, category: "cloud", project_id: null,
    source: "provider", request_id: "fixture", invoice_id: null, allocations: [{ projectId: project, basisPoints: 6000 }],
  };
  data.charges.push(base,
    { ...base, id: "credit", amount_minor: -1 },
    { ...base, id: "ils", amount_minor: 400, amount_ils_minor: 400, currency: "ILS", project_id: project, allocations: undefined },
    { ...base, id: "estimate", evidence: "estimate", amount_minor: 9999 },
    { ...base, id: "other-month", recorded_on: "2026-10-20" },
  );
  const access: Access = { data, ledger: null, role: "owner", user: { email: "fixture@d2r.test" } };
  const rows = allCharges(access, "2026-11", { status: actualStatus });
  const groups = costBreakdown(rows);
  const supplierTotal = groups.all.suppliers.get(supplier)!.total;
  assert.deepEqual(supplierTotal.currencies, new Map([["USD",100],["ILS",400]]));
  assert.equal(supplierTotal.ils, 400);
  assert.equal(supplierTotal.missingFx, true);
  assert.deepEqual(groups.projects.get(project)?.total.currencies, new Map([["USD",60],["ILS",400]]));
  assert.deepEqual(groups.projects.get(unassigned)?.total.currencies, new Map([["USD",40]]));
  const uncategorized = allCharges(access, "2026-11", { project: unassigned, status: actualStatus });
  assert.equal(uncategorized.length, 2);
  assert.equal(uncategorized.reduce((sum, row) => sum + (row.project_share_minor ?? 0), 0), 40);
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
    JSON.stringify({ BilledCost: 0.126, EffectiveCost: 8, BillingCurrency: "USD", ChargePeriodEnd: "2026-11-19T08:00:00Z", SubAccountId: "team_fixture", Tags: { ProjectId: "prj_fixtureTest" } }),
    JSON.stringify({ BilledCost: "-0.026", EffectiveCost: 0, BillingCurrency: "USD", ChargePeriodEnd: "2026-11-19T08:00:00Z", SubAccountId: "team_fixture" }),
  ].join("\n"), { headers: { "Content-Type": "application/jsonl" } }));
  const rows = await vercelConnector("fixture").syncCosts({ start: "2026-11-19", end: "2026-11-20", account: "team_fixture" });
  assert.equal(rows[0].minor, 10);
  assert.equal(rows[0].start, "2026-11-19");
  assert.deepEqual(rows[0].vercelBreakdown, { platformMinor: 0, projects: [{ id: "prj_fixtureTest", minor: 13 }] });
});

test("Vercel preserves project usage smaller than one cent per day", async t => {
  const days = ["01", "02", "03"];
  const result = days.flatMap(day => [
    { BilledCost: 0.277, ServiceName: "Pro", ChargeCategory: "Purchase" },
    { BilledCost: 0.004, Tags: { ProjectId: "prj_fixtureTest" } },
  ].map(item => JSON.stringify({ ...item, BillingCurrency: "USD", SubAccountId: "team_fixture",
    ChargePeriodEnd: `2026-11-${day}T00:00:00Z` })));
  t.mock.method(globalThis, "fetch", async () => new Response(result.join("\n"), { headers: { "content-type": "application/jsonl" } }));
  const rows = await vercelConnector("fixture").syncCosts({ start: "2026-11-01", end: "2026-12-01", account: "team_fixture" });
  assert.equal(rows.reduce((sum, row) => sum + row.minor, 0), 84);
  assert.equal(rows.flatMap(row => row.vercelBreakdown?.projects ?? []).reduce((sum, row) => sum + row.minor, 0), 1);
});

test("Vercel reporting attributes tagged cost and counts the configured fee once", () => {
  const data = emptyData();
  const month = businessDate().slice(0, 7);
  const date = month + "-01";
  data.usdReferenceRate = { quoted: date, quote: "3.345" };
  data.projects.push({ id: "product", name: "Project", status: "active", description: "", monthly_budget_minor: null, vercelProjectIds: ["prj_fixtureTest"] });
  data.subscriptions.push({ id: "sub", supplier_id: "vercel", label: "Vercel Pro", currency: "USD", amount_minor: 2000,
    status: "active", cycle: "monthly", next_charge_on: null, starts_on: date });
  data.charges.push({ id: "original", request_id: "receipt", description: "Vercel aggregate", source: "vercel",
    recorded_on: date, category: "פיתוח והרצה", amount_minor: 120, currency: "USD", evidence: "provider", supplier_id: "vercel",
    amount_ils_minor: 401, exchange_rate: { quote: "3.345", date, source: "fixture" }, invoice_id: null, project_id: null,
    vercelBreakdown: { platformMinor: 90, projects: [{ id: "prj_fixtureTest", minor: 20 }, { id: "prj_unknownProject", minor: 3 }] } });
  const entries = () => reportCharges(data, month, monthOffset(month, 1));
  assert.deepEqual(entries().map(row => [row.project_id, row.amount_minor]), [[null, 10], ["product", 20], [null, 2000]]);
  assert.equal(entries().reduce((total, row) => total + (row.amount_ils_minor ?? 0), 0), 6790);
  data.subscriptions = [];
  assert.equal(entries().reduce((total, row) => total + (row.amount_ils_minor ?? 0), 0), 401);
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
  assert.equal(isReceiptEmail("receipts@openrouter.ai","Your OpenRouter, Inc receipt [#1234-5678]",openRouter),true);
  assert.equal(isReceiptEmail("receipt@example.com","Your OpenRouter, Inc receipt [#1234-5678]",openRouter),false);
});
