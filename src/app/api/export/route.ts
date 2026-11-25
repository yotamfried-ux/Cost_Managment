import { workspace } from "@/lib/session";
import { allCharges } from "@/lib/queries";
import { resolveMonth, safeCsv, evidenceLabels } from "@/lib/finance";

export async function GET(request: Request) {
  const access = await workspace();
  if (!access) return new Response(null, { status: 401 });
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const month = resolveMonth(params.month);
  const annual = params.period === "annual";
  const entries = allCharges(access, annual ? month.slice(0,4) + "-01" : month, params, annual ? 12 : 1);
  const csv = safeCsv([
    ["תאריך", "ספק", "תיאור", "קטגוריה", "סכום ביחידות מטבע קטנות", "מטבע", "אגורות בש״ח", "מקור", "סטטוס"],
    ...entries.map(item => [item.recorded_on, item.suppliers?.name ?? "", item.description, item.category, item.amount_minor, item.currency,
      item.amount_ils_minor, item.source, evidenceLabels[item.evidence]]),
  ]);
  return new Response(csv, { headers: {
    "Cache-Control": "private, no-store", "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="d2r-expenses-${month}.csv"`,
  } });
}
