import { chargeShares, splitAmount } from "./allocation";
import { unassigned, type Charge } from "./queries";

export type CostTotal = {
  currencies: Map<string, number>;
  ils: number | null;
  missingFx: boolean;
  missingAmount: boolean;
};

export type SupplierCost = { id: string; name: string; total: CostTotal };
type CostGroup = { total: CostTotal; suppliers: Map<string, SupplierCost> };

const newTotal = (): CostTotal => ({ currencies: new Map(), ils: null, missingFx: false, missingAmount: false });
const newGroup = (): CostGroup => ({ total: newTotal(), suppliers: new Map() });

function addAmount(total: CostTotal, currency: string, minor: number | null, ils: number | null) {
  if (minor === null) {
    total.missingAmount = true;
    return;
  }
  total.currencies.set(currency, (total.currencies.get(currency) ?? 0) + minor);
  if (ils !== null) total.ils = (total.ils ?? 0) + ils;
  else if (minor !== 0) total.missingFx = true;
}

function addCost(group: CostGroup, row: Charge, minor: number | null, ils: number | null) {
  const id = row.supplier_id ?? unassigned;
  const supplier = group.suppliers.get(id) ?? { id, name: row.suppliers?.name || "ללא ספק", total: newTotal() };
  addAmount(supplier.total, row.currency, minor, ils);
  group.suppliers.set(id, supplier);
  addAmount(group.total, row.currency, minor, ils);
}

export function costBreakdown(rows: Charge[]) {
  const all = newGroup();
  const projects = new Map<string, CostGroup>();
  for (const row of rows) {
    addCost(all, row, row.amount_minor, row.amount_ils_minor);
    const shares = chargeShares(row);
    const original = row.amount_minor === null ? null : splitAmount(row.amount_minor, shares);
    const converted = row.amount_ils_minor === null ? null : splitAmount(row.amount_ils_minor, shares);
    const ids = shares.map(share => share.projectId);
    if (shares.reduce((sum, share) => sum + share.basisPoints, 0) < 10_000) ids.push("");
    for (const id of ids) {
      const key = id || unassigned;
      const group = projects.get(key) ?? newGroup();
      addCost(group, row, original?.get(id) ?? null, converted?.get(id) ?? null);
      projects.set(key, group);
    }
  }
  return { all, projects };
}
