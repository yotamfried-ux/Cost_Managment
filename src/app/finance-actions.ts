"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspace } from "@/lib/session";
import { currencies, minorUnits, resolveMonth } from "@/lib/finance";

const required = (length: number) => z.string().trim().min(1).max(length);
const optionalId = z.preprocess(value => value || null, z.uuid().nullable());
const date = z.iso.date();
const money = z.string().trim().regex(/^\d{1,10}(\.\d{1,3})?$/);
const routes = ["/", "/expenses", "/projects", "/suppliers", "/invoices", "/settings"];
const currenciesSchema = z.enum(currencies);

export async function mutate(kind: string, form: FormData) {
  const access = await requireWorkspace();
  const { db, id, role } = access;
  const fields = Object.fromEntries(form.entries());
  const route = routes.includes(String(fields.return)) ? String(fields.return) : "/";
  const month = resolveMonth(String(fields.month));
  const href = (name: string) => `${route}?month=${month}&${name}${name === "error=validation" || name === "error=save" ? `&add=${encodeURIComponent(kind)}` : ""}`;
  if (role === "viewer") redirect(href("error=permission"));
  let result: { error: unknown } | undefined;
  try {
    switch (kind) {
      case "expense": {
        const item = z.object({
          request: z.uuid(), description: required(240), category: required(80), evidence: z.enum(["estimate","missing"]),
          recorded: date, currency: currenciesSchema, supplier: optionalId, project: optionalId, amount: money.or(z.literal("")),
        }).parse(fields);
        result = await db.rpc("create_manual_charge", {
          org: id, request_key: item.request, details: item.description, charge_category: item.category,
          minor: item.evidence === "missing" ? null : minorUnits(item.amount, item.currency),
          unit: item.currency, recorded: item.recorded, supplier: item.supplier, project: item.project, charge_evidence: item.evidence,
        });
        break;
      }
      case "project": {
        const item = z.object({ name: required(100), description: z.string().trim().max(400), status: z.enum(["active","planned","archived"]), budget: money.or(z.literal("")) }).parse(fields);
        result = await db.from("projects").insert({ organization_id: id, name: item.name, description: item.description, status: item.status, monthly_budget_minor: item.budget ? minorUnits(item.budget, "ILS") : null });
        break;
      }
      case "supplier": {
        const item = z.object({ name: required(100), category: required(80) }).parse(fields);
        result = await db.from("suppliers").insert({ organization_id: id, ...item });
        break;
      }
      case "subscription": {
        const item = z.object({
          supplier: z.uuid(), label: required(120), currency: currenciesSchema, amount: money.or(z.literal("")),
          next: date.or(z.literal("")), cycle: z.enum(["monthly","annual","usage"]),
        }).parse(fields);
        result = await db.from("subscriptions").insert({
          organization_id: id, supplier_id: item.supplier, label: item.label, currency: item.currency,
          amount_minor: item.amount ? minorUnits(item.amount, item.currency) : null, cycle: item.cycle, next_charge_on: item.next || null,
        });
        break;
      }
      case "invoice": {
        const item = z.object({
          supplier: z.uuid(), number: required(100), amount: money, currency: currenciesSchema, issued: date,
          file: z.instanceof(File),
        }).parse(fields);
        if (item.file.size < 8 || item.file.size > 4 * 1024 * 1024 || item.file.type !== "application/pdf") break;
        const bytes = Buffer.from(await item.file.arrayBuffer());
        if (bytes.subarray(0, 5).toString() !== "%PDF-" || !bytes.subarray(-1024).includes("%%EOF")) break;
        const digest = createHash("sha256").update(bytes).digest("hex");
        const { data: existing, error: lookupError } = await db.from("invoices").select("sha256").eq("organization_id", id)
          .eq("supplier_id", item.supplier).eq("invoice_number", item.number).maybeSingle();
        if (lookupError) { result = { error: lookupError }; break; }
        if (existing && existing.sha256 !== digest) { result = { error: true }; break; }
        const { error } = await db.storage.from("d2r-invoices").upload(`${id}/${digest}.pdf`, bytes, { contentType: "application/pdf", upsert: false });
        if (error && !/already exists|duplicate/i.test(error.message)) { result = { error }; break; }
        result = await db.rpc("register_invoice", {
          org: id, supplier: item.supplier, number: item.number, issued: item.issued, minor: minorUnits(item.amount, item.currency),
          unit: item.currency, digest, filename: (item.file.name.split(/[\\/]/).pop() ?? "invoice.pdf").slice(0, 180),
        });
        break;
      }
      case "match": {
        const item = z.object({ invoice: z.uuid(), charge: z.uuid() }).parse(fields);
        result = await db.rpc("match_invoice", { org: id, ...item });
        break;
      }
      case "fx": {
        const item = z.object({ charge: z.uuid(), quote: z.string().regex(/^\d{1,8}(\.\d{1,10})?$/), quoted: date, source: required(180) }).parse(fields);
        result = await db.rpc("apply_charge_rate", { org: id, charge: item.charge, quote: item.quote, quoted: item.quoted, rate_source: item.source });
        break;
      }
      case "settings": {
        const item = z.object({ name: required(100), email: z.email().max(254).or(z.literal("")), number: z.string().trim().max(30), threshold: money.or(z.literal("")) }).parse(fields);
        result = await db.rpc("update_business", {
          org: id, business_name: item.name, number: item.number || null, email: item.email || null,
          threshold: item.threshold ? minorUnits(item.threshold, "ILS") : null,
        });
        break;
      }
    }
  } catch {
    result = undefined;
  }
  if (!result) redirect(href("error=validation"));
  if (result.error) redirect(href("error=save"));
  revalidatePath("/", "layout");
  redirect(href("saved=1"));
}
