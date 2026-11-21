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
