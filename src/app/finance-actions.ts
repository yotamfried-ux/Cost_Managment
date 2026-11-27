"use server";

import { createHash, randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspace } from "@/lib/session";
import { businessDate, currencies, minorUnits, resolveMonth } from "@/lib/finance";
import { overheadName, overheadProject } from "@/lib/allocation-rules";
import { applyExchangeRate, audit, flagCharge, matchInvoice } from "@/lib/ledger";
import { providerCatalog } from "@/lib/connectors";
import { cleanFilename, pdfMaxSize, validPdf } from "@/lib/documents";
import type { Charge, Invoice } from "@/lib/repository";
import { syncCosts } from "@/lib/sync-costs";

const required = (length: number) => z.string().trim().min(1).max(length);
const optionalId = z.preprocess(value => value || null, z.uuid().nullable());
const date = z.iso.date();
const money = z.string().trim().regex(/^\d{1,10}(\.\d{1,3})?$/);
const currenciesSchema = z.enum(currencies);
const vercelProjectIds = z.array(z.string().regex(/^prj_[A-Za-z0-9]{10,60}$/)).max(8);
const allowed = new Map([
  ["expense", ["/", "/expenses"]], ["project", ["/projects"]], ["supplier", ["/suppliers"]],
  ["subscription", ["/suppliers"]], ["invoice", ["/invoices"]], ["match", ["/invoices"]],
  ["fx", ["/expenses"]], ["rule", ["/projects"]], ["allocation", ["/expenses"]], ["settings", ["/settings"]], ["account", ["/integrations"]],
]);

export async function mutate(kind: string, form: FormData) {
  const { ledger, role, user } = await requireWorkspace();
  const fields = Object.fromEntries(form.entries());
  const route = allowed.get(kind)?.includes(String(fields.return)) ? String(fields.return) : "/";
  const month = resolveMonth(String(fields.month));
  const href = (field: string) => `${route}?month=${month}&${field}${field === "error=save" ? `&add=${encodeURIComponent(kind)}` : ""}`;
  if (!ledger || role === "viewer" || (["settings","account"].includes(kind) && role !== "owner")) redirect(href("error=permission"));

  try {
    let document: { id: string; bytes: Buffer } | undefined;
    let invoiceInput: {
      supplier: string; number: string; issued: string; currency: string; minor: number;
      receipt: string | null; name?: string; digest?: string;
    } | undefined;
    if (kind === "invoice") {
      const input = z.object({ supplier: z.uuid(), number: required(100), amount: money, currency: currenciesSchema,
        issued: date, receipt: optionalId }).parse(fields);
      invoiceInput = { ...input, minor: minorUnits(input.amount, input.currency) };
      if (!input.receipt) {
        const file = z.instanceof(File).parse(fields.file);
        if (file.size < 8 || file.size > pdfMaxSize || file.type !== "application/pdf") throw new Error("Invalid PDF");
        const bytes = Buffer.from(await file.arrayBuffer());
        if (!validPdf(bytes)) throw new Error("Invalid PDF");
        document = { id: randomUUID(), bytes };
        invoiceInput.name = cleanFilename(file.name);
        invoiceInput.digest = createHash("sha256").update(bytes).digest("hex");
      }
    }
    await ledger.transaction(data => {
      const requireSupplier = (id: string | null) => {
        if (id && !data.suppliers.some(item => item.id === id)) throw new Error("Unknown supplier");
      };
      const actor = user.email;
      switch (kind) {
        case "expense": {
          const item = z.object({ request: z.uuid(), description: required(240), category: required(80), evidence: z.enum(["estimate","missing"]),
            recorded: date, currency: currenciesSchema, supplier: optionalId, project: optionalId, amount: money.or(z.literal("")) }).parse(fields);
          if (data.charges.some(row => row.request_id === item.request)) return { result: null, changed: false };
          requireSupplier(item.supplier);
          if (item.project && !data.projects.some(project => project.id === item.project)) throw new Error("Unknown project");
          const amount = item.evidence === "missing" ? null : minorUnits(item.amount, item.currency);
          const charge: Charge = {
            id: randomUUID(), request_id: item.request, description: item.description, category: item.category, evidence: item.evidence,
            recorded_on: item.recorded, currency: item.currency, supplier_id: item.supplier, project_id: item.project,
            amount_minor: amount, amount_ils_minor: item.currency === "ILS" ? amount : null, invoice_id: null, source: "manual",
          };
          data.charges.unshift(charge);
          audit(data, actor, "charges", "INSERT", charge);
          break;
        }
        case "project": {
          const item = z.object({ name: required(100), description: z.string().trim().max(400), status: z.enum(["active","planned","archived"]), budget: money.or(z.literal("")) }).parse(fields);
          if (data.projects.some(row => row.name === item.name)) throw new Error("Project exists");
          const bindings = vercelProjectIds.parse(String(fields.vercelProjects ?? "").split(/[\s,]+/).filter(Boolean));
          if (new Set(bindings).size !== bindings.length ||
              data.projects.some(row => row.vercelProjectIds?.some(id => bindings.includes(id)))) throw new Error("Vercel project already assigned");
          const project = { id: randomUUID(), name: item.name, description: item.description, status: item.status,
            monthly_budget_minor: item.budget ? minorUnits(item.budget, "ILS") : null,
            ...(bindings.length ? { vercelProjectIds: bindings } : {}) };
          data.projects.push(project);
          audit(data, actor, "projects", "INSERT", project);
          break;
        }
        case "supplier": {
          const item = z.object({ name: required(100), category: required(80) }).parse(fields);
          if (data.suppliers.some(row => row.name === item.name)) throw new Error("Supplier exists");
          const supplier = { id: randomUUID(), ...item };
          data.suppliers.push(supplier);
          audit(data, actor, "suppliers", "INSERT", supplier);
          break;
        }
        case "subscription": {
          const item = z.object({ supplier: z.uuid(), label: required(120), currency: currenciesSchema, amount: money.or(z.literal("")),
            next: date.or(z.literal("")), cycle: z.enum(["monthly","annual","usage"]) }).parse(fields);
          requireSupplier(item.supplier);
          if (data.subscriptions.some(row => row.supplier_id === item.supplier && row.label === item.label)) throw new Error("Subscription exists");
          const subscription = { id: randomUUID(), supplier_id: item.supplier, label: item.label, currency: item.currency,
            amount_minor: item.amount ? minorUnits(item.amount, item.currency) : null, cycle: item.cycle,
            starts_on: item.next || businessDate(), next_charge_on: item.next || null, status: "active" };
          data.subscriptions.push(subscription);
          audit(data, actor, "subscriptions", "INSERT", subscription);
          break;
        }
        case "invoice": {
          if (!invoiceInput) throw new Error("Invalid PDF");
          const item = invoiceInput;
          requireSupplier(item.supplier);
          const inbox = data.inboxReceipts ?? [];
          const receipt = item.receipt ? inbox.find(row => row.id === item.receipt) : undefined;
          const id = receipt?.id ?? document?.id;
          const sha256 = receipt?.digest ?? item.digest;
          const original_name = receipt?.originalName ?? item.name;
          if (!id || !sha256 || !original_name) throw new Error("Document unavailable");
          if (data.invoices.some(row => row.sha256 === sha256)) return { result: null, changed: false };
          if (!receipt && inbox.some(row => row.digest === sha256)) throw new Error("Document exists in inbox");
          if (data.invoices.some(row => row.supplier_id === item.supplier && row.invoice_number === item.number)) throw new Error("Invoice number exists");
          const invoice: Invoice = { id, supplier_id: item.supplier, invoice_number: item.number, issued_on: item.issued,
            currency: item.currency, amount_minor: item.minor, status: "review", sha256, original_name, ...(receipt?.format ? { format: receipt.format } : {}) };
          data.invoices.unshift(invoice);
          audit(data, actor, "invoices", "INSERT", invoice);
          break;
        }
        case "match": {
          const item = z.object({ invoice: z.uuid(), charge: z.uuid() }).parse(fields);
          return { result: null, changed: matchInvoice(data, actor, item.invoice, item.charge) };
        }
        case "fx": {
          const item = z.object({ charge: z.uuid(), quote: z.string().regex(/^\d{1,8}(\.\d{1,10})?$/), quoted: date, source: required(180) }).parse(fields);
          const charge = data.charges.find(row => row.id === item.charge);
          if (!charge) throw new Error("Charge unavailable");
          const before = { ...charge };
          applyExchangeRate(charge, item);
          audit(data, actor, "charges", "UPDATE", charge, before);
          flagCharge(data, charge);
          break;
        }
        case "allocation": {
          const id = z.uuid().parse(fields.charge);
          const charge = data.charges.find(item => item.id === id);
          if (!charge) throw new Error("Charge unavailable");
          const selected = form.getAll("projectShare");
          const amounts = form.getAll("sharePercent");
          if (selected.length !== amounts.length || selected.length > data.projects.length) throw new Error("Invalid allocation");
          const allocations = [];
          const used = new Set<string>();
          let total = 0;
          for (let index = 0; index < selected.length; index++) {
            if (!selected[index] && !amounts[index]) continue;
            const projectId = z.uuid().parse(selected[index]);
            const percent = z.string().regex(/^\d{1,3}(\.\d{1,2})?$/).parse(amounts[index]);
            const basisPoints = minorUnits(percent,"ILS");
            if (!basisPoints || used.has(projectId) || !data.projects.some(item => item.id === projectId)) throw new Error("Invalid project share");
            used.add(projectId);
            total += basisPoints;
            allocations.push({ projectId, basisPoints });
          }
          if (total > 10_000) throw new Error("Allocation exceeds charge");
          const before = { ...charge };
          charge.project_id = null;
          charge.allocations = allocations;
          audit(data, actor, "charge_allocations", "UPDATE", charge, before);
          break;
        }
        case "settings": {
          const item = z.object({ name: required(100), email: z.email().max(254).or(z.literal("")), number: z.string().trim().max(30), threshold: money.or(z.literal("")) }).parse(fields);
          const before = data.business;
          data.business = { name: item.name, business_number: item.number || null, contact_email: item.email || null, alert_threshold_minor: item.threshold ? minorUnits(item.threshold, "ILS") : null };
          audit(data, actor, "business", "UPDATE", data.business, before);
          break;
        }
        case "account": {
          const item = z.object({ provider: z.enum(providerCatalog.map(row => row[0])), supplier: z.uuid(), external: required(160) }).parse(fields);
          requireSupplier(item.supplier);
          if (data.accounts.some(row => row.provider === item.provider && row.external_account_id === item.external)) throw new Error("Account exists");
          const account = { id: randomUUID(), provider: item.provider, supplier_id: item.supplier, external_account_id: item.external, last_synced_at: null };
          data.accounts.push(account);
          audit(data, actor, "provider_accounts", "INSERT", account);
          break;
        }
        case "rule": {
          const item = z.object({ supplier: z.uuid(), target: z.union([z.uuid(), z.literal("overhead"), z.literal("")]) }).parse(fields);
          requireSupplier(item.supplier);
          const rules = data.allocationRules ??= [];
          const index = rules.findIndex(rule => rule.supplier_id === item.supplier);
          if (!item.target) {
            if (index < 0) return { result: null, changed: false };
            audit(data, actor, "allocation_rules", "UPDATE", { supplier: item.supplier, removed: true });
            rules.splice(index, 1);
            break;
          }
          const project = item.target === "overhead"
            ? overheadProject(data.projects, () => ({ id: randomUUID(), name: overheadName, description: "עלויות משותפות שאינן שייכות לפרויקט אחד", status: "active", monthly_budget_minor: null, kind: "overhead" as const }))
            : data.projects.find(row => row.id === item.target);
          if (!project) throw new Error("Unknown project");
          if (index >= 0) rules[index].project_id = project.id;
          else rules.push({ id: randomUUID(), supplier_id: item.supplier, project_id: project.id });
          audit(data, actor, "allocation_rules", index >= 0 ? "UPDATE" : "INSERT", { supplier: item.supplier, project: project.id });
          break;
        }
        default: throw new Error("Unrecognized update");
      }
      return { result: null, document };
    });
  } catch {
    redirect(href("error=save"));
  }
  revalidatePath("/", "layout");
  redirect(href("saved=1"));
}

export async function syncVercel(form: FormData) {
  const { ledger, role } = await requireWorkspace();
  const base = "/integrations?month=" + resolveMonth(String(form.get("month")));
  if (!ledger || role !== "owner") redirect(base + "&error=permission");
  const result = await syncCosts(ledger, "vercel").catch(() => null);
  if (!result?.checked || result.failed) redirect(base + "&error=save");
  revalidatePath("/", "layout");
  redirect(base + "&saved=1");
}
