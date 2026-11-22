import { constantEqual } from "@/lib/auth";
import { businessDate, monthOffset } from "@/lib/finance";
import { daysBefore, fillReferenceRates, needsReferenceRate, referenceRates } from "@/lib/reference-rates";
import { LedgerRepository, storageConfig } from "@/lib/repository";

export const maxDuration = 30;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 24) return new Response(null, { status: 503 });
  if (!constantEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) return new Response(null, { status: 401 });
  const storage = storageConfig();
  if (!storage) return new Response(null, { status: 503 });
  const repository = new LedgerRepository(storage);
  const today = businessDate();
  const cutoff = daysBefore(today, 1);
  const since = monthOffset(today.slice(0, 7), -11) + "-01";
  const data = await repository.read();
  const rates = await referenceRates([
    { currency: "USD", date: today },
    ...data.charges.filter(row => needsReferenceRate(row, since, cutoff)).map(row => ({ currency: row.currency, date: row.recorded_on })),
  ]);
  const latest = rates.get("USD")?.at(-1);
  if (!latest) return new Response(null, { status: 502 });
  const newerQuote = (prior?: typeof latest) => !prior || latest.quoted > prior.quoted ||
    (latest.quoted === prior.quoted && latest.quote !== prior.quote);
  const advance = newerQuote(data.usdReferenceRate);
  const existingConversion = data.charges.some(row => needsReferenceRate(row, since, cutoff));
  const result = advance || existingConversion ? await repository.transaction(current => {
    const refreshed = newerQuote(current.usdReferenceRate);
    if (refreshed) current.usdReferenceRate = latest;
    const updated = fillReferenceRates(current, rates, since, cutoff);
    return { result: { refreshed, updated }, changed: refreshed || updated > 0 };
  }) : { refreshed: false, updated: 0 };
  console.info(JSON.stringify({ event: "reference_rates_refreshed", quoted: latest.quoted, ...result }));
  return Response.json({ quoted: latest.quoted, ...result });
}
