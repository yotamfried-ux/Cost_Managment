import { businessDate, monthOffset, type Evidence } from "./finance";
import type { requireWorkspace } from "./session";
import type { Charge as StoredCharge, Invoice as StoredInvoice, Subscription as StoredSubscription } from "./repository";
export type { Project, Supplier } from "./repository";

export type Access = Awaited<ReturnType<typeof requireWorkspace>>;
export type Search = { month?: string; q?: string; status?: string; project?: string; supplier?: string; category?: string; page?: string; sort?: string; error?: string; saved?: string; invoice?: string; receipt?: string; add?: string; period?: string };
export function searchFields(input: Search): Search {
  const supported: (keyof Search)[] = ["month","q","status","project","supplier","category","page","sort","error","saved","invoice","receipt","add","period"];
  return Object.fromEntries(supported.filter(key => typeof input[key] === "string").map(key => [key, input[key]?.slice(0,240)]));
}

export type Charge = StoredCharge & {
  suppliers: { name: string } | null;
  cost_allocations: { projects: { name: string } | null }[];
  reconciliation_matches: { invoice_id: string } | null;
};
export type Invoice = StoredInvoice & { suppliers: { name: string } | null };
export type Subscription = StoredSubscription & { suppliers: { name: string } | null };
export type Series = { name: string; total: number };
export type Summary = {
  evidence: { name: Evidence; total: number | null; entries: number; fx_missing: number }[];
  categories: Series[];
  trend: { month: string; verified: number | null; provider: number | null }[];
  projects: { project_id: string; total: number }[];
  suppliers: Series[];
  unallocated: number | null;
};

export const pageSize = 12;
export const pageNumber = (value?: string) => /^([1-9]\d{0,3})$/.test(value ?? "") ? Number(value) : 1;
export const isId = (value?: string) => !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const lower = (value?: string) => value?.trim().slice(0, 100).toLowerCase() ?? "";
const chronological = (sort?: string) => (a: string, b: string) => sort === "oldest" ? a.localeCompare(b) : b.localeCompare(a);

export function summary({ data }: Access, month: string, project?: string, months = 1): Summary {
  const end = monthOffset(month, months) + "-01";
  const start = month + "-01";
  const prior = monthOffset(month, -11) + "-01";
  const totals = new Map<Evidence, Summary["evidence"][number]>();
  const categories = new Map<string, number>();
  const suppliers = new Map<string, number>();
  const projects = new Map<string, number>();
  const trend = new Map<string, Summary["trend"][number]>();
  const supplierNames = new Map(data.suppliers.map(row => [row.id, row.name]));
  let unallocated: number | null = null;
  for (const charge of data.charges) {
    if (charge.recorded_on < prior || charge.recorded_on >= end || (project && charge.project_id !== project)) continue;
    const amount = charge.amount_ils_minor;
    const actual = charge.evidence === "verified" || charge.evidence === "provider";
    if (actual && amount !== null) {
      const key = charge.recorded_on.slice(0,7);
      const item = trend.get(key) ?? { month: key, verified: null, provider: null };
      item[charge.evidence as "verified" | "provider"] = (item[charge.evidence as "verified" | "provider"] ?? 0) + amount;
      trend.set(key, item);
    }
    if (charge.recorded_on < start) continue;
    const entry = totals.get(charge.evidence) ?? { name: charge.evidence, total: null, entries: 0, fx_missing: 0 };
    entry.entries++;
    if (amount !== null) entry.total = (entry.total ?? 0) + amount;
    else if (charge.amount_minor !== null) entry.fx_missing++;
    totals.set(charge.evidence, entry);
    if (!actual || amount === null) continue;
    if (amount > 0) {
      categories.set(charge.category, (categories.get(charge.category) ?? 0) + amount);
      const supplier = charge.supplier_id ? supplierNames.get(charge.supplier_id) : undefined;
      if (supplier) suppliers.set(supplier, (suppliers.get(supplier) ?? 0) + amount);
    }
    if (charge.project_id) projects.set(charge.project_id, (projects.get(charge.project_id) ?? 0) + amount);
    else unallocated = (unallocated ?? 0) + amount;
  }
  const rank = (items: Map<string, number>) => [...items].map(([name,total]) => ({ name,total })).sort((a,b) => b.total-a.total);
  return {
    evidence: [...totals.values()], categories: rank(categories), suppliers: rank(suppliers), trend: [...trend.values()],
    projects: [...projects].map(([project_id,total]) => ({ project_id,total })), unallocated,
  };
}

export function allCharges({ data }: Access, month: string, filters: Search, months = 1): Charge[] {
  const next = monthOffset(month, months) + "-01";
  const term = lower(filters.q);
  const suppliers = new Map(data.suppliers.map(row => [row.id,row.name]));
  const projects = new Map(data.projects.map(row => [row.id,row.name]));
  return data.charges.filter(row => row.recorded_on >= month + "-01" && row.recorded_on < next &&
      row.description.toLowerCase().includes(term) && (!isId(filters.supplier) || filters.supplier === row.supplier_id) &&
      (!isId(filters.project) || filters.project === row.project_id) && (!filters.category || filters.category === row.category) &&
      (!filters.status || filters.status === row.evidence))
    .sort((a,b) => chronological(filters.sort)(a.recorded_on,b.recorded_on) || a.id.localeCompare(b.id))
    .map(row => ({
      ...row, suppliers: row.supplier_id ? { name: suppliers.get(row.supplier_id) ?? "" } : null,
      cost_allocations: row.project_id ? [{ projects: { name: projects.get(row.project_id) ?? "" } }] : [],
      reconciliation_matches: row.invoice_id ? { invoice_id: row.invoice_id } : null,
    }));
}

export function listCharges(access: Access, month: string, filters: Search) {
  const first = (pageNumber(filters.page) - 1) * pageSize;
  const rows = allCharges(access, month, filters);
  return { rows: rows.slice(first, first + pageSize), count: rows.length };
}

export function lookups({ data }: Access) {
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "he");
  return { projects: data.projects.toSorted(byName), suppliers: data.suppliers.toSorted(byName) };
}

export function invoices({ data }: Access, month: string, filters: Search) {
  const first = (pageNumber(filters.page) - 1) * pageSize;
  const suppliers = new Map(data.suppliers.map(row => [row.id,row.name]));
  const all = data.invoices.map(row => ({ ...row, suppliers: { name: suppliers.get(row.supplier_id) ?? "" } }));
  const rows = all.filter(row => row.issued_on.startsWith(month) && row.invoice_number.toLowerCase().includes(lower(filters.q)) &&
    (!filters.status || row.status === filters.status) && (!isId(filters.supplier) || row.supplier_id === filters.supplier))
    .sort((a,b) => chronological(filters.sort)(a.issued_on,b.issued_on) || a.id.localeCompare(b.id));
  const firstDate = monthOffset(month, -11) + "-01";
  const lastDate = monthOffset(month, 1) + "-01";
  return { rows: rows.slice(first, first + pageSize), count: rows.length, selected: all.find(row => row.id === filters.invoice),
    history: all.filter(row => row.issued_on >= firstDate && row.issued_on < lastDate) };
}

export function subscriptions({ data }: Access, onlyUpcoming = false): Subscription[] {
  const today = businessDate();
  const cutoff = new Date(Date.parse(today + "T00:00:00Z") + 14 * 86400000).toISOString().slice(0, 10);
  const suppliers = new Map(data.suppliers.map(row => [row.id,row.name]));
  return data.subscriptions.filter(row => !onlyUpcoming || (row.status === "active" && row.next_charge_on && row.next_charge_on >= today && row.next_charge_on <= cutoff))
    .sort((a,b) => (a.next_charge_on ?? "~").localeCompare(b.next_charge_on ?? "~"))
    .map(row => ({ ...row, suppliers: { name: suppliers.get(row.supplier_id) ?? "" } }));
}
