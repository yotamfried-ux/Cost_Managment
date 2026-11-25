import { constantEqual } from "@/lib/auth";
import { LedgerRepository, storageConfig } from "@/lib/repository";
import { syncCosts } from "@/lib/sync-costs";

export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 24) return new Response(null, { status: 503 });
  if (!constantEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) return new Response(null, { status: 401 });
  const storage = storageConfig();
  if (!storage) return new Response(null, { status: 503 });
  const result = await syncCosts(new LedgerRepository(storage));
  if (!result) return new Response(null, { status: 503 });
  return Response.json(result, { status: result.failed ? 502 : 200 });
}
