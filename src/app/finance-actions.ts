"use server";

import { createHash, randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspace } from "@/lib/session";
import { currencies, minorUnits, resolveMonth } from "@/lib/finance";
import { applyExchangeRate, audit, flagCharge, matchInvoice } from "@/lib/ledger";
import { providerCatalog } from "@/lib/connectors";
import type { Charge, Invoice } from "@/lib/repository";

const required = (length: number) => z.string().trim().min(1).max(length);
const optionalId = z.preprocess(value => value || null, z.uuid().nullable());
const date = z.iso.date();
const money = z.string().trim().regex(/^\d{1,10}(\.\d{1,3})?$/);
const currenciesSchema = z.enum(currencies);
const allowed = new Map([
  ["expense", ["/", "/expenses"]], ["project", ["/projects"]], ["supplier", ["/suppliers"]],
  ["subscription", ["/suppliers"]], ["invoice", ["/invoices"]], ["match", ["/invoices"]],
  ["fx", ["/expenses"]], ["settings", ["/settings"]], ["account", ["/integrations"]],
]);

export async function mutate(kind: string, form: FormData) {
  const { ledger, role, user } = await requireWorkspace();
  const fields = Object.fromEntries(form.entries());
  const route = allowed.get(kind)?.includes(String(fields.return)) ? String(fields.return) : "/";
  const month = resolveMonth(String(fields.month));
  const href = (field: string) => `${route}?month=${month}&${field}${field === "error=save" ? `&add=${encodeURIComponent(kind)}` : ""}`;
  if (role === "viewer" || (["settings","account"].includes(kind) && role !== "owner")) redirect(href("error=permission"));

  try {
    let document: { id: string; bytes: Buffer } | undefined;
    let invoiceInput: Omit<Invoice, "status"> | undefined;
    if (kind === "invoice") {
      const input = z.object({ supplier: z.uuid(), number: required(100), amount: money, currency: currenciesSchema, issued: date, file: z.instanceof(File) }).parse(fields);
      if (input.file.size < 8 || input.file.size > 4 * 1024 * 1024 || input.file.type !== "application/pdf") throw new Error("Invalid PDF");
      const bytes = Buffer.from(await input.file.arrayBuffer());
      if (bytes.subarray(0,5).toString() !== "%PDF-" || !bytes.subarray(-1024).includes("%%EOF")) throw new Error("Invalid PDF");
      const id = randomUUID();
      document = { id, bytes };
      invoiceInput = {
        id, supplier_id: input.supplier, invoice_number: input.number, issued_on: input.issued, currency: input.currency,
        amount_minor: minorUnits(input.amount, input.currency), sha256: createHash("sha256").update(bytes).digest("hex"),
        original_name: (input.file.name.split(/[\\/]/).pop() || "invoice.pdf").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").slice(0, 180) || "invoice.pdf",
      };
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
          const project = { id: randomUUID(), name: item.name, description: item.description, status: item.status,
            monthly_budget_minor: item.budget ? minorUnits(item.budget, "ILS") : null };
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
            amount_minor: item.amount ? minorUnits(item.amount, item.currency) : null, cycle: item.cycle, next_charge_on: item.next || null, status: "active" };
          data.subscriptions.push(subscription);
          audit(data, actor, "subscriptions", "INSERT", subscription);
          break;
        }
        case "invoice": {
          if (!invoiceInput || !document) throw new Error("Invalid PDF");
          const item = invoiceInput;
          requireSupplier(item.supplier_id);
          if (data.invoices.some(row => row.sha256 === item.sha256)) return { result: null, changed: false };
          if (data.invoices.some(row => row.supplier_id === item.supplier_id && row.invoice_number === item.invoice_number)) throw new Error("Invoice number exists");
          const invoice: Invoice = { ...item, status: "review" };
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
