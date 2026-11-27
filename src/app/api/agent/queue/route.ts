import { verifyRequest } from "@/lib/business";
import { claimDue, maxQueueBody, queueRequest, reportPublication, type Claimed } from "@/lib/publishing";
import { LedgerRepository, storageConfig } from "@/lib/repository";

export const maxDuration = 30;

type QueueResult = { item: Claimed | null } | { ok: true } | { ok: false; reason: string };

// Publisher endpoint (n8n). Separate secret from the agent's ingest: the agent can propose posts but can never claim or
// report them, and the publisher can never create or approve one. A claim hands out only posts the owner approved.
export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > maxQueueBody) return new Response(null, { status: 413 });
  const body = await request.text();
  if (Buffer.byteLength(body) > maxQueueBody) return new Response(null, { status: 413 });
  const verdict = verifyRequest(process.env.D2R_PUBLISHER_SECRET, request.headers.get("x-d2r-timestamp"), request.headers.get("x-d2r-signature"), body);
  if (verdict === "unconfigured") return new Response(null, { status: 503 });
  if (verdict !== "ok") return new Response(null, { status: 401 });
  const storage = storageConfig();
  if (!storage) return new Response(null, { status: 503 });
  let parsed;
  try { parsed = queueRequest.safeParse(JSON.parse(body)); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  const input = parsed.data;
  try {
    const result = await new LedgerRepository(storage).transaction<QueueResult>(data => {
      if (input.action === "claim") { const { item, changed } = claimDue(data); return { result: { item }, changed }; }
      const outcome = reportPublication(data, input);
      return { result: outcome, changed: outcome.ok };
    });
    if ("ok" in result && result.ok === false) return Response.json({ error: result.reason }, { status: 409 });
    return Response.json(result);
  } catch {
    return new Response(null, { status: 502 });
  }
}
