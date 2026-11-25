import { randomUUID } from "node:crypto";
import { constantEqual } from "@/lib/auth";
import { connectors, type ProviderCost } from "@/lib/connectors";
import { monthOffset } from "@/lib/finance";
import { ingestCost, registerVercelBilling } from "@/lib/ledger";
import { LedgerRepository, storageConfig, type Run } from "@/lib/repository";
import { fillReferenceRates, needsReferenceRate, referenceRates } from "@/lib/reference-rates";

export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 24) return new Response(null, { status: 503 });
  if (!constantEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) return new Response(null, { status: 401 });
  const storage = storageConfig();
  if (!storage) return new Response(null, { status: 503 });
  const ledger = new LedgerRepository(storage);
  const adapters = connectors();
  let data = await ledger.read();
  const teamId = process.env.VERCEL_BILLING_TEAM_ID;
  if (teamId && adapters.has("vercel") && !data.accounts.some(item => item.provider === "vercel" && item.external_account_id === teamId)) {
    data = await ledger.transaction(current => ({ result: current, changed: registerVercelBilling(current, teamId) }));
  }
  const accounts = data.accounts.filter(item => adapters.has(item.provider));
  if (accounts.length > 10) return new Response(null, { status: 503 });

  const today = new Date().toISOString().slice(0,10);
  const month = today.slice(0,7);
  const monthStart = month + "-01";
  const yesterday = new Date(Date.parse(today + "T00:00:00Z") - 86400000).toISOString().slice(0,10);
  const windows = [
    { start: monthOffset(month,-1) + "-01", end: monthStart },
    ...(yesterday > monthStart ? [{ start: monthStart, end: yesterday }] : []),
  ];
  const batches = await Promise.all(accounts.map(async account => {
    const started_at = new Date().toISOString();
    let costs: ProviderCost[] = [];
    let reason: string | null = null;
    try {
      const adapter = adapters.get(account.provider)!;
      const results = await Promise.all(windows.map(async window => {
        const rows = await adapter.syncCosts({ ...window, account: account.external_account_id });
        if (rows.some(row => row.start < window.start || row.start >= window.end || row.end > window.end ||
            !Number.isSafeInteger(row.minor) || Math.abs(row.minor) > 10 ** 12)) throw new Error("vendor_data");
        return rows;
      }));
      costs = results.flat();
    } catch (error) {
      reason = error instanceof Error && ["permission","vendor_request","vendor_data"].includes(error.message) ? error.message : "provider_response";
    }
    const run: Run = {
      id: randomUUID(), provider_account_id: account.id, status: reason ? "failed" : "completed",
      reason, observed_count: costs.length, started_at, finished_at: new Date().toISOString(),
    };
    return { run, costs };
  }));
  const earliestRateDate = monthOffset(month,-11) + "-01";
  const rates = await referenceRates([
    ...data.charges.filter(row => needsReferenceRate(row, earliestRateDate, yesterday)).map(row => ({ currency: row.currency, date: row.recorded_on })),
    ...batches.flatMap(batch => batch.costs.map(row => ({ currency: row.currency, date: row.start }))),
  ]);
  const result = await ledger.transaction(current => {
    for (const batch of batches) {
      const account = current.accounts.find(item => item.id === batch.run.provider_account_id);
      if (!account) continue;
      if (current.runs.some(run => run.id === batch.run.id)) continue;
      const latest = current.runs.find(run => run.provider_account_id === account.id && run.status === "completed");
      if (!batch.run.reason && (!latest || latest.started_at <= batch.run.started_at)) {
        for (const cost of batch.costs) ingestCost(current, account.id, cost);
        account.last_synced_at = batch.run.finished_at;
      }
      current.runs.unshift(batch.run);
    }
    current.runs.sort((a,b) => b.started_at.localeCompare(a.started_at));
    const ratesUpdated = fillReferenceRates(current, rates, earliestRateDate, yesterday);
    const failed = batches.filter(batch => batch.run.status === "failed").length;
    return { result: { checked: accounts.length, failed, ratesUpdated }, changed: batches.length > 0 || ratesUpdated > 0 };
  });
  console.info(JSON.stringify({ event: "cost_sync_completed", ...result }));
  return Response.json(result, { status: result.failed ? 502 : 200 });
}
