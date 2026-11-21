import { workspace } from "@/lib/session";
import { chargesQuery, type Charge } from "@/lib/queries";
import { resolveMonth, safeCsv, evidenceLabels } from "@/lib/finance";

export async function GET(request: Request) {
  const access = await workspace();
  if (!access || !(access.id)) return new Response(null, { status: 401 });
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const month = resolveMonth(params.month);
  const year = params.period === "annual";
  const entries: Charge[] = [];
  const batch = 500;
  for (let start = 0; start < 20000; start += batch) {
    const { data, error } = await chargesQuery(access, year ? month.slice(0, 4) + "-01" : month, params, year ? 12 : 1, false).range(start, start + batch - 1).overrideTypes<Charge[], { merge: false }>();
    if (error) return new Response(null, { status: 503 });
    entries.push(...data);
    if (data.length < batch) break;
  }
  if (entries.length === 20000) return new Response("יש לבחור תקופה קטנה יותר", { status: 413 });
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
