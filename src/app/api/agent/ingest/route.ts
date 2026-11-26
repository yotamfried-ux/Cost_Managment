import { applyBatch, batchInput, IngestError, maxBody, verifyRequest } from "@/lib/business";
import { LedgerRepository, storageConfig } from "@/lib/repository";

export const maxDuration = 30;

// Machine-to-machine endpoint for the Director agent. Signed body, short clock window, idempotent by batchId.
export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > maxBody) return new Response(null, { status: 413 });
  const body = await request.text();
  if (Buffer.byteLength(body) > maxBody) return new Response(null, { status: 413 });
  const verdict = verifyRequest(process.env.D2R_AGENT_SECRET, request.headers.get("x-d2r-timestamp"), request.headers.get("x-d2r-signature"), body);
  if (verdict === "unconfigured") return new Response(null, { status: 503 });
  if (verdict !== "ok") return new Response(null, { status: 401 });
  const storage = storageConfig();
  if (!storage) return new Response(null, { status: 503 });
  let parsed;
  try { parsed = batchInput.safeParse(JSON.parse(body)); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  if (!parsed.success) return Response.json({ error: "invalid_batch", issues: parsed.error.issues.slice(0, 5).map(issue => ({ path: issue.path.join("."), code: issue.code })) }, { status: 400 });
  try {
    const result = await new LedgerRepository(storage).transaction(data => {
      const outcome = applyBatch(data, parsed.data);
      return { result: outcome, changed: !outcome.duplicate };
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof IngestError) return Response.json({ error: error.message }, { status: error.status });
    return new Response(null, { status: 502 });
  }
}
