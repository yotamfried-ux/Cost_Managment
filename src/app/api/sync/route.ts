import { createHash, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { connectors } from "@/lib/connectors";
import { monthOffset } from "@/lib/finance";

export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response(null, { status: 503 });
  const hash = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(hash(request.headers.get("authorization") ?? ""), hash(`Bearer ${secret}`))) return new Response(null, { status: 401 });
  const org = z.uuid().safeParse(process.env.D2R_SYNC_ORG_ID);
  if (!org.success || !process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) return new Response(null, { status: 503 });
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const adapters = connectors();
  const { data: accounts, error } = await db.from("provider_accounts").select("id,provider,external_account_id")
    .eq("organization_id", org.data).in("provider", [...adapters.keys(), "disabled"]);
  if (error) return new Response(null, { status: 503 });
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const monthStart = month + "-01";
  const yesterday = new Date(Date.parse(today + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
  const windows = [
    { start: monthOffset(month, -1) + "-01", end: monthStart },
    ...(yesterday > monthStart ? [{ start: monthStart, end: yesterday }] : []),
  ];
  const completed = await Promise.all(accounts.map(async account => {
    const adapter = adapters.get(account.provider);
    if (!adapter) return false;
    const { data: run, error: insertError } = await db.from("sync_runs").insert({
      organization_id: org.data, provider_account_id: account.id, status: "running",
    }).select("id").single();
    if (insertError) return false;
    let count = 0;
    try {
      for (const window of windows) {
        const costs = await adapter.syncCosts({ ...window, account: account.external_account_id });
        for (const cost of costs) {
          if (cost.start < window.start || cost.start >= window.end || cost.end > window.end ||
              !Number.isSafeInteger(cost.minor)) throw new Error("vendor_data");
          const { error: ingestError } = await db.rpc("ingest_provider_cost", {
            account: account.id, event_key: cost.key, digest: hash(JSON.stringify(cost)).toString("hex"), event: cost,
          });
          if (ingestError) throw new Error("storage");
          count++;
        }
      }
      const { error: finishError } = await db.from("sync_runs").update({ status: "completed", finished_at: new Date().toISOString(), observed_count: count }).eq("id", run.id);
      return !finishError;
    } catch (error) {
      const reason = error instanceof Error && ["permission", "vendor_request", "storage", "vendor_data"].includes(error.message) ? error.message : "provider_response";
      await db.from("sync_runs").update({ status: "failed", reason, observed_count: count, finished_at: new Date().toISOString() }).eq("id", run.id);
      return false;
    }
  }));
  const failed = completed.filter(status => !status).length;
  return Response.json({ checked: accounts.length, failed }, { status: failed ? 502 : 200 });
}
