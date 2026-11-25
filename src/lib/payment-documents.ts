import { randomUUID } from "node:crypto";
import PostalMime from "postal-mime";
import { extractText, getDocumentProxy } from "unpdf";
import { minorUnits } from "./finance";
import { audit, matchInvoice } from "./ledger";
import type { Charge, InboxReceipt, Invoice, WorkspaceData } from "./repository";

const providers = {
  "supabase.com": ["Supabase", "תשתיות ענן"],
  "hetzner.com": ["Hetzner", "תשתיות ענן"],
  "vercel.com": ["Vercel", "פיתוח והרצה"],
  "openrouter.ai": ["OpenRouter", "כלי AI"],
  "namecheap.com": ["Namecheap", "דומיינים ואירוח"],
} as const;
type Domain = keyof typeof providers;
export type PaymentDocument = {
  domain: Domain; kind: "invoice" | "receipt"; number: string; date: string; minor: number;
};

function englishDate(raw: string) {
  const millis = Date.parse(raw + " 12:00:00 GMT");
  if (Number.isFinite(millis)) return new Date(millis).toISOString().slice(0, 10);
}

export function supportsPaymentDocument(receipt: InboxReceipt) {
  const domain = receipt.sender.toLowerCase().split("@").at(-1) ?? "";
  if (!Object.hasOwn(providers, domain)) return false;
  return domain === "openrouter.ai" || domain === "namecheap.com" ? receipt.format === "eml" : receipt.format === undefined;
}

const standaloneReceipts = new Set<Domain>(["openrouter.ai", "namecheap.com"]);

export function parsePaymentText(domain: Domain, input: string, subject = ""): PaymentDocument | undefined {
  const text = input.replace(/\u0000/g, "-").replace(/\s+/g, " ").trim();
  const dateText = "([A-Za-z]{3,9} \\d{1,2}, 20\\d{2})";
  let number: string | undefined;
  let date: string | undefined;
  let amount: string | undefined;
  let kind: PaymentDocument["kind"] = "invoice";
  switch (domain) {
    case "supabase.com": {
      if (!/^invoice\b|^receipt\b/i.test(text)) return;
      kind = /^receipt\b/i.test(text) ? "receipt" : "invoice";
      number = text.match(/\bInvoice number ([A-Z0-9]{3,20}-\d{3,12})\b/)?.[1];
      const label = kind === "receipt" ? "Payment date" : "Invoice date";
      const dates = text.match(new RegExp(`\\b${label} ${dateText}`));
      if (dates) date = englishDate(dates[1]);
      const amounts = [...text.matchAll(kind === "receipt" ? /\bAmount paid \$(\d{1,8}\.\d{2})\b/g : /\bAmount due \$(\d{1,8}\.\d{2})\b/g)];
      if (amounts.length && amounts.every(row => row[1] === amounts[0][1])) amount = amounts[0][1];
      break;
    }
    case "vercel.com": {
      const header = text.match(/\b(Invoice|Receipt) Invoice number\b/);
      if (!header || !/\bVercel Inc\b/.test(text)) return;
      kind = header[1] === "Receipt" ? "receipt" : "invoice";
      number = text.match(/\bInvoice number ([A-Z0-9]{3,20}-\d{3,12})\b/)?.[1];
      const dates = text.match(new RegExp(`\\b${kind === "receipt" ? "Date paid" : "Date of issue"} ${dateText}`));
      if (dates) date = englishDate(dates[1]);
      amount = text.match(kind === "receipt" ? /\bAmount paid \$(\d{1,8}\.\d{2})\b/ : /\bAmount due \$(\d{1,8}\.\d{2}) USD\b/)?.[1];
      break;
    }
    case "hetzner.com": {
      if (!text.includes("Hetzner Online GmbH")) return;
      number = text.match(/\bInvoice no\.: (\d{8,16})\b/)?.[1];
      const dates = text.match(/\bInvoice date: (\d{2})\/(\d{2})\/(20\d{2})\b/);
      if (dates) date = `${dates[3]}-${dates[2]}-${dates[1]}`;
      amount = text.match(/\bTotal \$\s*\d{1,8}\.\d{2} \$\s*\d{1,8}\.\d{2} \$\s*\d{1,8}\.\d{2} \$\s*(\d{1,8}\.\d{2})\b/)?.[1];
      break;
    }
    case "openrouter.ai": {
      kind = "receipt";
      number = subject.match(/^Your OpenRouter, Inc\.? receipt \[#?(\d+-\d+)\]$/i)?.[1];
      const paid = text.match(new RegExp(`\\bAmount paid \\$(\\d{1,8}\\.\\d{2}) Date paid ${dateText}`, "i"));
      if (paid && text.includes("OpenRouter Credits") &&
          text.match(/\bOpenRouter Credits\s*:\s*\$(\d{1,8}\.\d{2})\b/)?.[1] === paid[1]) {
        amount = paid[1];
        date = englishDate(paid[2]);
      }
      break;
    }
    case "namecheap.com": {
      kind = "receipt";
      number = subject.match(/^Namecheap Order Summary \(Order# (\d{6,16})\);?$/i)?.[1];
      if (!number || text.match(/\bOrder Number\s*:\s*(\d{6,16})\b/i)?.[1] !== number ||
          !/\bTransaction ID\s*:\s*\d{6,16}\b/i.test(text) ||
          !/\bApproval #\s*:\s*ch_[A-Za-z0-9]+\b/.test(text) ||
          !/\bTotal Refund\s*:\s*N\/A\b/i.test(text)) return;
      const paid = text.match(/\bInitial Charge\s*:\s*\$(\d{1,8}\.\d{2})\b/i)?.[1];
      const final = text.match(/\bFinal Cost\s*:\s*\$(\d{1,8}\.\d{2})\b/i)?.[1];
      const dates = text.match(new RegExp(`\\bOrder Date\\s*:\\s*${dateText}`, "i"));
      if (dates && paid && paid === final) {
        amount = paid;
        date = englishDate(dates[1]);
      }
      break;
    }
  }
  if (!number || !date || !amount) return;
  const parsedDate = new Date(date + "T00:00:00Z");
  if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) return;
  return { domain, kind, number, date, minor: minorUnits(amount, "USD") };
}

export async function readPaymentDocument(receipt: InboxReceipt, bytes: Buffer) {
  if (!supportsPaymentDocument(receipt) || bytes.length > 2 * 1024 * 1024) return;
  const domain = receipt.sender.toLowerCase().split("@").at(-1) as Domain;
  try {
    if (receipt.format === "eml") {
      const message = await PostalMime.parse(bytes);
      if (message.from?.address?.toLowerCase() !== receipt.sender.toLowerCase()) return;
      return parsePaymentText(domain, message.text ?? "", receipt.subject);
    }
    const pdf = await getDocumentProxy(new Uint8Array(bytes), { stopAtErrors: true });
    try {
      if (pdf.numPages > 8) return;
      return parsePaymentText(domain, (await extractText(pdf, { mergePages: true })).text);
    } finally {
      await pdf.loadingTask.destroy();
    }
  } catch {
    return;
  }
}

export function applyPaymentDocument(data: WorkspaceData, receipt: InboxReceipt, parsed: PaymentDocument) {
  const [name, category] = providers[parsed.domain];
  const result = { filed: 0, paid: 0, linked: 0 };
  let supplier = data.suppliers.find(item => item.name.toLowerCase() === name.toLowerCase());
  let invoice = supplier && data.invoices.find(item => item.supplier_id === supplier!.id && item.invoice_number === parsed.number);
  if (invoice && (invoice.currency !== "USD" || invoice.amount_minor !== parsed.minor ||
      (parsed.kind === "invoice" && invoice.issued_on !== parsed.date))) return result;
  if (!invoice) {
    if (parsed.kind === "receipt" && !standaloneReceipts.has(parsed.domain)) return result;
    if (data.invoices.some(item => item.id === receipt.id || item.sha256 === receipt.digest)) return result;
    if (!supplier) {
      supplier = { id: randomUUID(), name, category };
      data.suppliers.push(supplier);
      audit(data, "gmail", "suppliers", "INSERT", supplier);
    }
    invoice = {
      id: receipt.id, original_name: receipt.originalName, sha256: receipt.digest,
      invoice_number: parsed.number, issued_on: parsed.date, supplier_id: supplier.id, currency: "USD",
      amount_minor: parsed.minor, status: "review", ...(receipt.format ? { format: receipt.format } : {}),
    } satisfies Invoice;
    data.invoices.unshift(invoice);
    audit(data, "gmail", "invoices", "INSERT", invoice);
    result.filed++;
  }
  if (parsed.kind === "receipt" && parsed.minor > 0 && (parsed.domain === "supabase.com" || standaloneReceipts.has(parsed.domain)) &&
      invoice.status === "review" && !data.charges.some(row => row.supplier_id === invoice!.supplier_id &&
        row.currency === invoice!.currency && row.amount_minor === invoice!.amount_minor && row.recorded_on.slice(0, 7) === parsed.date.slice(0, 7))) {
    const charge: Charge = {
      id: randomUUID(), description: `${parsed.domain === "openrouter.ai" ? "OpenRouter Credits" : name} · ${parsed.number}`,
      recorded_on: parsed.date, amount_minor: parsed.minor, currency: "USD", evidence: "verified", category,
      supplier_id: invoice.supplier_id, amount_ils_minor: null, source: "gmail", request_id: receipt.id,
      project_id: null, invoice_id: null,
    };
    data.charges.unshift(charge);
    audit(data, "gmail", "charges", "INSERT", charge);
    matchInvoice(data, "gmail", invoice.id, charge.id);
    result.paid++;
  }
  if (receipt.id !== invoice.id && receipt.supportingInvoiceId !== invoice.id) {
    receipt.supportingInvoiceId = invoice.id;
    result.linked++;
  }
  return result;
}
