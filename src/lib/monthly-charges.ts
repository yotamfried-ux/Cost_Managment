import { businessDate, convertToIlsMinor, monthOffset } from "./finance";
import type { Charge, WorkspaceData } from "./repository";

export function monthlyManualCharges(
  data: Pick<WorkspaceData, "charges" | "subscriptions" | "usdReferenceRate" | "audit" | "suppliers">,
  firstMonth: string,
  end: string,
  today = businessDate(),
) {
  const registered = new Map<string, string>();
  for (const entry of data.audit) {
    if (entry.entity !== "subscriptions" || entry.operation !== "INSERT" || !entry.after || typeof entry.after !== "object") continue;
    const id = "id" in entry.after ? entry.after.id : undefined;
    if (typeof id === "string") registered.set(id, businessDate(new Date(entry.created_at)));
  }
  const suppliers = new Map(data.suppliers.map(row => [row.id, row]));
  const projected: Charge[] = [];
  for (let month = firstMonth; month < end && month <= today.slice(0, 7); month = monthOffset(month, 1)) {
    projected.push(...manualChargesForMonth(data, month, today, registered, suppliers));
  }
  return projected;
}

function manualChargesForMonth(
  data: Pick<WorkspaceData, "charges" | "subscriptions" | "usdReferenceRate">,
  month: string, today: string, registered: Map<string, string>, suppliers: Map<string, WorkspaceData["suppliers"][number]>,
) {
  const end = monthOffset(month, 1) + "-01";
  const monthly = data.subscriptions.filter(row => row.status === "active" && row.cycle === "monthly" && row.amount_minor !== null &&
    (row.starts_on ?? registered.get(row.id) ?? row.next_charge_on ?? today) < end);
  if (!monthly.length) return [];
  const actual = data.charges.filter(row => row.recorded_on.startsWith(month) &&
    (row.evidence === "verified" || row.evidence === "provider"));
  const available = new Map<string, Charge[]>();
  for (const charge of actual) {
    if (charge.supplier_id && (charge.amount_minor ?? 0) > 0) {
      const matches = available.get(charge.supplier_id) ?? [];
      matches.push(charge);
      available.set(charge.supplier_id, matches);
    }
  }

  const name = (label: string) => label.split(" · ", 1)[0].trim().toLowerCase();
  const remaining = monthly.filter(subscription => {
    const matches = available.get(subscription.supplier_id);
    const matched = matches?.findIndex(charge => name(charge.description) === name(subscription.label)) ?? -1;
    if (matched < 0 || !matches) return true;
    matches.splice(matched, 1);
    return false;
  });

  const reference = data.usdReferenceRate;
  const quote = reference && reference.quoted <= today && /^\d{1,6}(\.\d{1,10})?$/.test(reference.quote) &&
    Number(reference.quote) > 0 ? reference.quote : null;
  const projected: Charge[] = [];
  for (const subscription of remaining) {
    const matches = available.get(subscription.supplier_id);
    const matched = matches?.findIndex(charge => charge.currency === subscription.currency &&
      charge.amount_minor === subscription.amount_minor) ?? -1;
    if (matched >= 0 && matches) {
      matches.splice(matched, 1);
      continue;
    }
    const { amount_minor: amount, currency } = subscription;
    const id = `monthly:${subscription.id}:${month}`;
    const first = subscription.starts_on ?? registered.get(subscription.id) ?? subscription.next_charge_on ?? today;
    projected.push({
      id, request_id: id, description: subscription.label.replace(/ · אומדן חודשי$/, ""),
      recorded_on: first.startsWith(month) ? first : month + "-01",
      amount_minor: amount, currency, supplier_id: subscription.supplier_id,
      amount_ils_minor: amount === null ? null : currency === "ILS" ? amount : currency === "USD" && quote ? convertToIlsMinor(amount, currency, quote) : null,
      evidence: "manual", source: "מנוי חודשי", category: suppliers.get(subscription.supplier_id)?.category ?? "אחרות",
      project_id: null, invoice_id: null,
    });
  }
  return projected;
}
