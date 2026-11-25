import { createHash } from "node:crypto";
import { workspace } from "@/lib/session";
import { isId } from "@/lib/queries";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await workspace();
  if (!access) return new Response(null, { status: 401 });
  if (!isId(id)) return new Response(null, { status: 404 });
  const invoice = access.data.invoices.find(row => row.id === id);
  const receipt = access.data.inboxReceipts?.find(row => row.id === id);
  if (!invoice && !receipt) return new Response(null, { status: 404 });
  const bytes = await access.ledger?.document(id);
  if (!bytes || createHash("sha256").update(bytes).digest("hex") !== (invoice?.sha256 ?? receipt?.digest)) return new Response(null, { status: 404 });
  const eml = (invoice?.format ?? receipt?.format) === "eml";
  const defaultFilename = eml ? "receipt.eml" : "invoice.pdf";
  const filename = encodeURIComponent((invoice?.original_name ?? receipt?.originalName ?? defaultFilename).toWellFormed()).replace(/['()*]/g, char => "%" + char.charCodeAt(0).toString(16).toUpperCase());
  return new Response(new Uint8Array(bytes), { headers: {
    "Content-Type": eml ? "message/rfc822" : "application/pdf", "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `attachment; filename="${defaultFilename}"; filename*=UTF-8''${filename}`,
    "Cache-Control": "private, no-store", "Content-Security-Policy": "default-src 'none'; sandbox",
  } });
}
