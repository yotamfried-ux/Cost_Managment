import { businessDate, convertToIlsMinor, monthOffset } from "./finance";
import type { Charge, WorkspaceData } from "./repository";

export type MonthlyForecast = {
  totalIls: number | null;
  subscriptionIls: number | null;
  missing: number;
};

export function monthlyForecast(
  data: Pick<WorkspaceData, "charges" | "subscriptions" | "usdReferenceRate">,
  month: string,
  today = businessDate(),
): MonthlyForecast | null {
  if (month < today.slice(0, 7)) return null;

  const end = monthOffset(month, 1) + "-01";
  const monthly = data.subscriptions.filter(row => row.status === "active" && row.cycle === "monthly" &&
    (!row.next_charge_on || row.next_charge_on < end));
  if (!monthly.length) return null;

  const actual = data.charges.filter(row => row.recorded_on.startsWith(month) &&
    (row.evidence === "verified" || row.evidence === "provider"));
  const available = new Map<string, Charge[]>();
  let totalIls: number | null = null;
  let subscriptionIls: number | null = null;
  let missing = 0;
  for (const charge of actual) {
    if (charge.amount_ils_minor === null) missing++;
    else totalIls = (totalIls ?? 0) + charge.amount_ils_minor;
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
  for (const subscription of remaining) {
    const matches = available.get(subscription.supplier_id);
    const matched = matches?.findIndex(charge => charge.currency === subscription.currency &&
      charge.amount_minor === subscription.amount_minor) ?? -1;
    if (matched >= 0 && matches) {
      matches.splice(matched, 1);
      continue;
    }
    const { amount_minor: amount, currency } = subscription;
    if (amount === null || (currency !== "ILS" && !(currency === "USD" && quote))) {
      missing++;
      continue;
    }
    const ils = currency === "USD" && quote ? convertToIlsMinor(amount, currency, quote) : amount;
    subscriptionIls = (subscriptionIls ?? 0) + ils;
    totalIls = (totalIls ?? 0) + ils;
  }
  return { totalIls, subscriptionIls, missing };
}
