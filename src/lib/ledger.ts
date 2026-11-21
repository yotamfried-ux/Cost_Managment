import { createHash, randomUUID } from "node:crypto";
import type { ProviderCost } from "./connectors";
import type { Charge, Role, WorkspaceData } from "./repository";

export function assertWriter(role: Role) {
  if (role === "viewer") throw new Error("permission");
}

export function audit(data: WorkspaceData, actor: string, entity: string, operation: "INSERT" | "UPDATE", after: unknown, before?: unknown) {
  data.audit.unshift({
    id: randomUUID(), entity, actor, operation, created_at: new Date().toISOString(),
    before: structuredClone(before), after: structuredClone(after),
  });
}

export function flagCharge(data: WorkspaceData, charge: Charge) {
  if (data.business.alert_threshold_minor !== null && charge.amount_ils_minor !== null &&
      charge.amount_ils_minor >= data.business.alert_threshold_minor && ["verified", "provider"].includes(charge.evidence)) {
    alert(data, "charge_threshold", charge.id);
  }
}

function alert(data: WorkspaceData, code: "charge_threshold" | "verified_source_changed", reference: string) {
  if (data.alerts.some(item => item.code === code && item.reference === reference)) return;
  data.alerts.unshift({ id: randomUUID(), code, reference, created_at: new Date().toISOString() });
}

export function matchInvoice(data: WorkspaceData, actor: string, invoiceId: string, chargeId: string) {
  const invoice = data.invoices.find(item => item.id === invoiceId);
  const charge = data.charges.find(item => item.id === chargeId);
  if (!invoice || !charge || invoice.amount_minor !== charge.amount_minor || invoice.currency !== charge.currency || invoice.supplier_id !== charge.supplier_id) throw new Error("Invoice mismatch");
  if (charge.invoice_id === invoice.id) return false;
  if (charge.invoice_id || invoice.status !== "review") throw new Error("Invoice already matched");
  if (charge.evidence === "estimate" && data.charges.some(row => row.evidence === "provider" &&
    row.supplier_id === charge.supplier_id && row.amount_minor === charge.amount_minor && row.currency === charge.currency &&
    row.recorded_on.slice(0, 7) === charge.recorded_on.slice(0, 7))) throw new Error("Matching provider charge exists");
  const beforeCharge = { ...charge };
  const beforeInvoice = { ...invoice };
  charge.invoice_id = invoice.id;
  charge.evidence = "verified";
  invoice.status = "matched";
  audit(data, actor, "charges", "UPDATE", charge, beforeCharge);
  audit(data, actor, "invoices", "UPDATE", invoice, beforeInvoice);
  flagCharge(data, charge);
  return true;
}

export function applyExchangeRate(charge: Charge, input: { quote: string; quoted: string; source: string }) {
  if (charge.currency === "ILS" || charge.amount_minor === null || input.quoted > charge.recorded_on || Number(input.quote) <= 0) throw new Error("Invalid rate");
  const digits = new Intl.NumberFormat("en", { style: "currency", currency: charge.currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const [whole, fraction = ""] = input.quote.split(".");
  const scale = 10n ** BigInt(digits + fraction.length);
  const amount = BigInt(Math.abs(charge.amount_minor));
  const numerator = amount * BigInt(whole + fraction) * 100n;
  const minor = Math.sign(charge.amount_minor) * Number((numerator + scale / 2n) / scale);
  if (!Number.isSafeInteger(minor)) throw new Error("Conversion overflow");
  charge.exchange_rate = { quote: input.quote, date: input.quoted, source: input.source };
  charge.amount_ils_minor = minor;
}

export function ingestCost(data: WorkspaceData, accountId: string, event: ProviderCost) {
  const account = data.accounts.find(item => item.id === accountId);
  if (!account) throw new Error("Provider account removed");
  const digest = createHash("sha256").update(JSON.stringify(event)).digest("hex");
  if (data.costEvents.some(row => row.account === accountId && row.key === event.key && row.digest === digest)) return false;
  data.costEvents.push({ account: accountId, key: event.key, digest, observedAt: new Date().toISOString(), payload: event });
  const charge = data.charges.find(row => row.account_id === accountId && row.external_key === event.key);
  if (charge?.evidence === "verified") {
    if (charge.amount_minor !== event.minor) alert(data, "verified_source_changed", charge.id);
    return true;
  }
  if (charge) {
    const before = { ...charge };
    charge.amount_minor = event.minor;
    charge.amount_ils_minor = event.currency === "ILS" ? event.minor : null;
    if (charge.exchange_rate) applyExchangeRate(charge, { quote: charge.exchange_rate.quote, quoted: charge.exchange_rate.date, source: charge.exchange_rate.source });
    audit(data, "sync", "charges", "UPDATE", charge, before);
    flagCharge(data, charge);
    return true;
  }
  const entry: Charge = {
    id: randomUUID(), request_id: randomUUID(), description: event.label, category: ["github","vercel"].includes(account.provider) ? "פיתוח והרצה" : "כלי AI",
    recorded_on: event.start, billing_period_end: event.end, amount_minor: event.minor, currency: event.currency,
    evidence: "provider", source: account.provider, supplier_id: account.supplier_id, amount_ils_minor: event.currency === "ILS" ? event.minor : null,
    project_id: null, invoice_id: null, account_id: accountId, external_key: event.key,
  };
  data.charges.unshift(entry);
  audit(data, "sync", "charges", "INSERT", entry);
  flagCharge(data, entry);
  return true;
}
