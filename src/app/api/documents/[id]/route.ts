import { createHash } from "node:crypto";
import { workspace } from "@/lib/session";
import { isId } from "@/lib/queries";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await workspace();
  if (!access) return new Response(null, { status: 401 });
  if (!isId(id)) return new Response(null, { status: 404 });
  const invoice = access.data.invoices.find(row => row.id === id);
  if (!invoice) return new Response(null, { status: 404 });
  const bytes = await access.ledger.document(invoice.id);
  if (!bytes || createHash("sha256").update(bytes).digest("hex") !== invoice.sha256) return new Response(null, { status: 404 });
  const filename = encodeURIComponent(invoice.original_name.toWellFormed()).replace(/['()*]/g, char => "%" + char.charCodeAt(0).toString(16).toUpperCase());
  return new Response(new Uint8Array(bytes), { headers: {
    "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="invoice.pdf"; filename*=UTF-8''${filename}`,
    "Cache-Control": "private, no-store", "Content-Security-Policy": "default-src 'none'; sandbox",
  } });
}
