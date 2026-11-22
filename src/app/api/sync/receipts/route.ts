import { constantEqual } from "@/lib/auth";
import { gmailConfig, GmailImportError, googleReceipts } from "@/lib/gmail-receipts";
import { audit } from "@/lib/ledger";
import { LedgerRepository, storageConfig } from "@/lib/repository";
import { applyPaymentDocument, readPaymentDocument, supportsPaymentDocument } from "@/lib/payment-documents";

export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 24) return new Response(null, { status: 503 });
  if (!constantEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) return new Response(null, { status: 401 });
  const config = gmailConfig();
  const storage = storageConfig();
  if (!config || !storage) return new Response(null, { status: 503 });
  const repository = new LedgerRepository(storage);
  let phase = "storage_read";
  try {
    const old = await repository.read();
    phase = "gmail_payload";
    const { output: batch, counts } = await googleReceipts(config, old.inboxReceipts ?? []);
    phase = "document_read";
    const filed = new Set(old.invoices.map(item => item.id));
    const backlog = (old.inboxReceipts ?? []).filter(item => !filed.has(item.id) && !item.supportingInvoiceId && supportsPaymentDocument(item)).slice(0, 5);
    const candidates = (await Promise.all([
      ...batch.map(async ({ item, bytes }) => ({ item, parsed: await readPaymentDocument(item, bytes) })),
      ...backlog.map(async item => {
        const bytes = await repository.document(item.id).catch(() => null);
        return { item, parsed: bytes ? await readPaymentDocument(item, bytes) : undefined };
      }),
    ])).sort((a,b) => Number(a.parsed?.kind === "receipt") - Number(b.parsed?.kind === "receipt"));
    phase = "storage_write";
    const result = await repository.transaction(data => {
      const receipts = data.inboxReceipts ?? [];
      const fingerprints = new Set([...receipts.map(item => item.digest), ...data.invoices.map(item => item.sha256)]);
      const added = [];
      for (const entry of batch) {
        if (fingerprints.has(entry.item.digest) || receipts.some(item => item.messageId === entry.item.messageId && item.attachmentId === entry.item.attachmentId)) continue;
        fingerprints.add(entry.item.digest);
        receipts.unshift(entry.item);
        audit(data, "gmail", "receipt_inbox", "INSERT", { id: entry.item.id, source: "gmail" });
        added.push({ id: entry.item.id, bytes: entry.bytes });
      }
      data.inboxReceipts = receipts;
      const totals = { added: added.length, filed: 0, paid: 0, linked: 0 };
      for (const { item, parsed } of candidates) {
        const source = receipts.find(row => row.id === item.id && row.digest === item.digest);
        if (!source || !parsed) continue;
        const updates = applyPaymentDocument(data, source, parsed);
        totals.filed += updates.filed;
        totals.paid += updates.paid;
        totals.linked += updates.linked;
      }
      return { result: totals, changed: Object.values(totals).some(Boolean), documents: added };
    });
    console.info(JSON.stringify({ event: "gmail_receipt_import_completed", ...result, counts }));
    return Response.json(result);
  } catch (error) {
    const details = error instanceof GmailImportError ? { stage: error.stage, status: error.status, code: error.code } : { stage: phase };
    console.warn(JSON.stringify({ event: "gmail_receipt_import_failed", ...details }));
    return new Response(null, { status: 502 });
  }
}
