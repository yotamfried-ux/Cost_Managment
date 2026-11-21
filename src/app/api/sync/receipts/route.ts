import { constantEqual } from "@/lib/auth";
import { gmailConfig, googleReceipts } from "@/lib/gmail-receipts";
import { audit } from "@/lib/ledger";
import { LedgerRepository, storageConfig } from "@/lib/repository";

export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 24) return new Response(null, { status: 503 });
  if (!constantEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) return new Response(null, { status: 401 });
  const config = gmailConfig();
  const storage = storageConfig();
  if (!config || !storage) return new Response(null, { status: 503 });
  const repository = new LedgerRepository(storage);
  try {
    const old = await repository.read();
    const batch = await googleReceipts(config, old.inboxReceipts ?? []);
    const count = await repository.transaction(data => {
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
      return { result: added.length, changed: Boolean(added.length), documents: added };
    });
    return Response.json({ added: count });
  } catch {
    return new Response(null, { status: 502 });
  }
}
