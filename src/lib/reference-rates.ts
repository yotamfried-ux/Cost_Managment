import { applyExchangeRate, audit, flagCharge } from "./ledger";
import type { Charge, WorkspaceData } from "./repository";

const supported = new Set(["USD", "EUR", "GBP"]);
const source = "בנק ישראל · שער יציג";
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (date: string) => datePattern.test(date) && Number.isFinite(Date.parse(date + "T00:00:00Z"));
type Rate = { quote: string; quoted: string };
type RateWindow = { currency: string; date: string };

export function needsReferenceRate(charge: Charge, since: string, until: string) {
  return ["verified", "provider"].includes(charge.evidence) && charge.amount_minor !== null &&
    charge.amount_ils_minor === null && !charge.exchange_rate && charge.recorded_on >= since && charge.recorded_on <= until &&
    supported.has(charge.currency) && validDate(charge.recorded_on);
}

function daysBefore(date: string, days: number) {
  return new Date(Date.parse(date + "T00:00:00Z") - days * 86_400_000).toISOString().slice(0, 10);
}

export async function referenceRates(requests: RateWindow[]) {
  const ranges = new Map<string, { start: string; end: string }>();
  for (const { currency, date } of requests) {
    if (!supported.has(currency) || !validDate(date)) continue;
    const range = ranges.get(currency);
    ranges.set(currency, { start: !range || date < range.start ? date : range.start, end: !range || date > range.end ? date : range.end });
  }
  const results = await Promise.all([...ranges].map(async ([currency, range]) => {
    const rates: Rate[] = [];
    try {
      const start = daysBefore(range.start, 7);
      const url = new URL(`https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/RER_${currency}_ILS`);
      url.search = new URLSearchParams({ startPeriod: start, endPeriod: range.end, format: "csv" }).toString();
      const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(7000) });
      if (!response.ok || !response.headers.get("content-type")?.includes("text/csv")) throw new Error("unexpected response");
      const [header, ...lines] = (await response.text()).trim().split(/\r?\n/);
      if (!header.endsWith(",TIME_PERIOD,OBS_VALUE,RELEASE_STATUS")) throw new Error("unexpected CSV fields");
      for (const line of lines) {
        const fields = line.split(",");
        if (fields[0] !== `RER_${currency}_ILS` || fields[1] !== "D" || fields[2] !== currency ||
            fields[3] !== "ILS" || fields[5] !== "OF00" || fields[6] !== "BOI_MRKT" || fields[9] !== "Y" || fields[10] !== "0") continue;
        const [quoted, quote] = fields.slice(-3);
        if (validDate(quoted) && quoted >= start && quoted <= range.end &&
            /^\d{1,6}(\.\d{1,10})?$/.test(quote ?? "") && Number(quote) > 0) rates.push({ quote, quoted });
      }
    } catch {
      console.warn(JSON.stringify({ event: "reference_rates_unavailable", currency }));
    }
    return [currency, rates.sort((a,b) => a.quoted.localeCompare(b.quoted))] as const;
  }));
  return new Map(results);
}

export function fillReferenceRates(data: WorkspaceData, rates: Awaited<ReturnType<typeof referenceRates>>, since: string, until: string) {
  let updated = 0;
  for (const charge of data.charges) {
    if (!needsReferenceRate(charge, since, until)) continue;
    const earliest = daysBefore(charge.recorded_on, 7);
    const rate = rates.get(charge.currency)?.findLast(row => row.quoted >= earliest && row.quoted <= charge.recorded_on);
    if (!rate) continue;
    const before = { ...charge };
    applyExchangeRate(charge, { ...rate, source });
    audit(data, "sync", "charges", "UPDATE", charge, before);
    flagCharge(data, charge);
    updated++;
  }
  return updated;
}
