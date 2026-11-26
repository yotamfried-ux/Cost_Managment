import { constantEqual } from "@/lib/auth";
import { gmailConfig, GmailImportError, googleReceipts } from "@/lib/gmail-receipts";
import { audit } from "@/lib/ledger";
import { LedgerRepository, storageConfig, type GmailRun } from "@/lib/repository";
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
  const started = new Date().toISOString();
  let phase = "storage_read";
  try {
    const old = await repository.read();
    phase = "gmail_payload";
    const { output: batch, counts, progress, hasMore } = await googleReceipts(config, old.inboxReceipts ?? [], old.gmailScan);
    phase = "document_read";
    const filed = new Set(old.invoices.map(item => item.id));
    const backlog = (old.inboxReceipts ?? []).filter(item => item.paymentData === undefined &&
      (item.supportingInvoiceId || !filed.has(item.id)) && supportsPaymentDocument(item)).slice(0, 5);
    const candidates = await Promise.all([
      ...batch.map(async ({ item, bytes }) => ({ item, parsed: await readPaymentDocument(item, bytes) ?? null })),
      ...backlog.map(async item => {
        const bytes = await repository.document(item.id).catch(() => null);
        return { item, parsed: bytes ? await readPaymentDocument(item, bytes) ?? null : undefined };
      }),
    ]);
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
      const byId = new Map(receipts.map(row => [row.id, row]));
      for (const { item, parsed } of candidates) {
        const source = byId.get(item.id);
        if (source?.digest === item.digest && parsed !== undefined) source.paymentData = parsed;
      }
      const filedNow = new Set(data.invoices.map(item => item.id));
      const normalized = receipts.filter(row => row.paymentData && !row.supportingInvoiceId && !filedNow.has(row.id))
        .sort((a,b) => Number(a.paymentData?.kind === "receipt") - Number(b.paymentData?.kind === "receipt"));
      for (const source of normalized) {
        const updates = applyPaymentDocument(data, source, source.paymentData!);
        totals.filed += updates.filed;
        totals.paid += updates.paid;
        totals.linked += updates.linked;
      }
      if (JSON.stringify(data.gmailScan) === JSON.stringify(old.gmailScan)) data.gmailScan = progress;
      const invoiceIds = new Set(data.invoices.map(item => item.id));
      const review = receipts.filter(item => !item.supportingInvoiceId && !invoiceIds.has(item.id)).length;
      const run: GmailRun = { at: started, status: counts.failedMessages ? "partial" : "completed", ...totals, review, hasMore };
      data.gmailRuns = [run, ...(data.gmailRuns ?? [])].sort((a,b) => b.at.localeCompare(a.at)).slice(0, 30);
      return { result: run, documents: added };
    });
    console.info(JSON.stringify({ event: "gmail_receipt_import_completed", ...result, counts }));
    return Response.json(result);
  } catch (error) {
    const details = error instanceof GmailImportError ? { stage: error.stage, status: error.status, code: error.code } : { stage: phase };
    console.warn(JSON.stringify({ event: "gmail_receipt_import_failed", ...details }));
    await repository.transaction(data => {
      const run: GmailRun = { at: started, status: "failed", reason: details.code ?? details.stage, added: 0, filed: 0, paid: 0, linked: 0, review: null, hasMore: false };
      data.gmailRuns = [run, ...(data.gmailRuns ?? [])].sort((a,b) => b.at.localeCompare(a.at)).slice(0, 30);
      return { result: null };
    }).catch(() => undefined);
    return new Response(null, { status: 502 });
  }
}
