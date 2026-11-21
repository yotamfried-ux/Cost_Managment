import { businessDate, monthOffset } from "./finance";
import type { Currency, Evidence } from "./finance";
import type { requireWorkspace } from "./session";

export type Access = Awaited<ReturnType<typeof requireWorkspace>>;
export type Search = { month?: string; q?: string; status?: string; project?: string; supplier?: string; category?: string; page?: string; sort?: string; error?: string; saved?: string; invoice?: string; add?: string; period?: string };
export type Project = { id: string; name: string; description: string; status: string; monthly_budget_minor: number | null };
export type Supplier = { id: string; name: string; category: string };
export type Charge = {
  id: string; description: string; recorded_on: string; amount_minor: number | null; currency: Currency; evidence: Evidence;
  category: string; supplier_id: string | null; amount_ils_minor: number | null; source: string;
  suppliers: { name: string } | null;
  cost_allocations: { projects: { name: string } | null }[];
  reconciliation_matches: { invoice_id: string } | null;
};
export type Invoice = {
  id: string; invoice_number: string; original_name: string; issued_on: string; supplier_id: string; currency: Currency;
  amount_minor: number; status: string; suppliers: { name: string } | null;
};
export type Subscription = {
  id: string; label: string; amount_minor: number | null; currency: Currency; cycle: string; next_charge_on: string | null;
  status: string; suppliers: { name: string } | null;
};
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
const normalizedSearch = (value?: string) => value?.trim().slice(0, 100).replace(/[\\%_]/g, "\\$&");

export async function summary({ db, id }: Access, month: string, project?: string, months = 1): Promise<Summary> {
  const { data, error } = await db.rpc("finance_summary", { org: id, first_day: month + "-01", last_day: monthOffset(month, months) + "-01", project: project ?? null });
  if (error) throw new Error("Finance summary unavailable");
  return data;
}

export function chargesQuery({ db, id }: Access, month: string, filters: Search, months = 1, includeCount = true) {
  const allocations = isId(filters.project) ? "cost_allocations!inner" : "cost_allocations";
  let query = db.from("charges")
    .select(`id,description,recorded_on,amount_minor,currency,evidence,category,supplier_id,amount_ils_minor,source,suppliers(name),${allocations}(projects(name),project_id),reconciliation_matches(invoice_id)`, { count: includeCount ? "exact" : undefined })
    .eq("organization_id", id).gte("recorded_on", month + "-01").lt("recorded_on", monthOffset(month, months) + "-01");
  const term = normalizedSearch(filters.q);
  if (term) query = query.ilike("description", `%${term}%`);
  if (isId(filters.supplier)) query = query.eq("supplier_id", filters.supplier);
  if (isId(filters.project)) query = query.eq("cost_allocations.project_id", filters.project);
  if (filters.category) query = query.eq("category", filters.category.slice(0, 100));
  if (["verified", "provider", "estimate", "missing"].includes(filters.status ?? "")) query = query.eq("evidence", filters.status);
  return query.order("recorded_on", { ascending: filters.sort === "oldest" }).order("id");
}

export async function listCharges(access: Access, month: string, filters: Search) {
  const first = (pageNumber(filters.page) - 1) * pageSize;
  const { data, count, error } = await chargesQuery(access, month, filters).range(first, first + pageSize - 1).overrideTypes<Charge[], { merge: false }>();
  if (error) throw new Error("Expense list unavailable");
  return { rows: data, count: count ?? 0 };
}

export async function lookups({ db, id }: Access) {
  const [projects, suppliers] = await Promise.all([
    db.from("projects").select("id,name,description,status,monthly_budget_minor").eq("organization_id", id).order("name").overrideTypes<Project[], { merge: false }>(),
    db.from("suppliers").select("id,name,category").eq("organization_id", id).order("name").overrideTypes<Supplier[], { merge: false }>(),
  ]);
  if (projects.error || suppliers.error) throw new Error("Finance directory unavailable");
  return { projects: projects.data, suppliers: suppliers.data };
}

export async function invoices({ db, id }: Access, month: string, filters: Search) {
  const first = (pageNumber(filters.page) - 1) * pageSize;
  const base = () => db.from("invoices").select("id,invoice_number,original_name,issued_on,supplier_id,currency,amount_minor,status,suppliers(name)", { count: "exact" }).eq("organization_id", id);
  let query = base().gte("issued_on", month + "-01").lt("issued_on", monthOffset(month, 1) + "-01");
  if (isId(filters.supplier)) query = query.eq("supplier_id", filters.supplier);
  const term = normalizedSearch(filters.q);
  if (term) query = query.ilike("invoice_number", `%${term}%`);
  if (["review", "matched"].includes(filters.status ?? "")) query = query.eq("status", filters.status);
  const [list, selected, scoped] = await Promise.all([
    query.order("issued_on", { ascending: filters.sort === "oldest" }).order("id").range(first, first + pageSize - 1).overrideTypes<Invoice[], { merge: false }>(),
    isId(filters.invoice) ? base().eq("id", filters.invoice).maybeSingle().overrideTypes<Invoice, { merge: false }>() : null,
    db.from("invoices").select("id,status,issued_on,suppliers(name)").eq("organization_id", id)
      .gte("issued_on", monthOffset(month, -11) + "-01").lt("issued_on", monthOffset(month, 1) + "-01")
      .order("issued_on", { ascending: false }).limit(1000).overrideTypes<Pick<Invoice, "id" | "status" | "issued_on" | "suppliers">[], { merge: false }>(),
  ]);
  if (list.error || selected?.error || scoped.error) throw new Error("Invoice list unavailable");
  return { rows: list.data, count: list.count ?? 0, selected: selected?.data, history: scoped.data };
}

export async function subscriptions({ db, id }: Access, onlyUpcoming = false) {
  const today = businessDate();
  const cutoff = new Date(Date.parse(today + "T00:00:00Z") + 14 * 86400000).toISOString().slice(0, 10);
  const query = db.from("subscriptions").select("id,label,amount_minor,currency,cycle,next_charge_on,status,suppliers(name)").eq("organization_id", id)
    .order("next_charge_on", { nullsFirst: false });
  if (onlyUpcoming) query.eq("status", "active").gte("next_charge_on", today).lte("next_charge_on", cutoff);
  const { data, error } = await query.limit(100).overrideTypes<Subscription[], { merge: false }>();
  if (error) throw new Error("Subscription list unavailable");
  return data;
}
