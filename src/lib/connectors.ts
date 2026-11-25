import { z } from "zod";
import { vercelConnector } from "./vercel-billing";
import { googleBillingConfig, googleBillingConnector } from "./google-billing";

export const providerCatalog = [
  ["vercel", "Vercel", "חשבוניות ונתוני חיוב של הצוות"],
  ["supabase", "Supabase", "חשבוניות הארגון ונתוני שימוש"],
  ["hetzner", "Hetzner", "חשבוניות מקור בגישה לקריאה"],
  ["github", "GitHub", "חיוב לפי שימוש בחשבון ארגון"],
  ["google-cloud", "Google Cloud · Gemini API", "נתוני חשבון חיוב של פרויקט Gemini מיצוא BigQuery"],
  ["google-ai", "Google AI Pro", "קבלת מנוי אישית"],
  ["gmail", "Gmail", "קליטת קבלות מספקים מאושרים"],
  ["claude-pro", "Claude Pro", "קבלה אישית מאזור החיוב או מחנות האפליקציות"],
  ["anthropic", "Anthropic API", "דוח עלויות לשימוש ב־API"],
  ["openai", "OpenAI API", "דוח עלויות של ארגון API"],
  ["chatgpt-plus", "ChatGPT Plus", "קבלת מנוי אישית"],
  ["cloudflare", "Cloudflare", "חשבוניות או נתוני שימוש ב־R2 וב־Stream"],
  ["openrouter", "OpenRouter", "חשבונית רכישת קרדיטים או דוח שימוש"],
  ["resend", "Resend", "מסמכי חיוב וסיכומי שימוש"],
  ["namecheap", "Namecheap", "חשבונית חידוש דומיינים"],
] as const;
export type ProviderKey = (typeof providerCatalog)[number][0];

export type ProviderCost = { key: string; start: string; end: string; label: string; minor: number; currency: string };
export interface CostConnector {
  provider: ProviderKey;
  syncCosts(input: { start: string; end: string; account: string }): Promise<ProviderCost[]>;
}

const decimal = z.union([z.number().finite(), z.string().regex(/^-?\d+(\.\d+)?$/)]).transform(Number).pipe(z.number().finite());

async function getJson(url: URL, headers: Record<string, string>) {
  const response = await fetch(url, { headers, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "permission" : "vendor_request");
  return response.json() as Promise<unknown>;
}

const openAiPage = z.object({
  data: z.array(z.object({
    start_time: z.number().int(), end_time: z.number().int(),
    results: z.array(z.object({ amount: z.object({ value: decimal, currency: z.string().regex(/^[a-z]{3}$/i) }) })),
  })),
  has_more: z.boolean(),
  next_page: z.string().nullish(),
});
const anthropicPage = z.object({
  data: z.array(z.object({
    starting_at: z.iso.datetime({ offset: true }), ending_at: z.iso.datetime({ offset: true }),
    results: z.array(z.object({ amount: decimal, currency: z.literal("USD") })),
  })),
  has_more: z.boolean(),
  next_page: z.string().nullish(),
});

const startUnix = (day: string) => String(Math.floor(Date.parse(day + "T00:00:00Z") / 1000));
const dayFromUnix = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

function toCost(start: string, end: string, label: string, currency: string, minor: number): ProviderCost {
  return { key: `${start}:${end}:${currency}`, start, end, label, minor: Math.sign(minor) * Math.round(Math.abs(minor)), currency };
}

export function openAiConnector(key: string): CostConnector {
  return { provider: "openai", async syncCosts({ start, end }) {
    const url = new URL("https://api.openai.com/v1/organization/costs");
    url.search = new URLSearchParams({ start_time: startUnix(start), end_time: startUnix(end), bucket_width: "1d", limit: "31" }).toString();
    const output: ProviderCost[] = [];
    for (let page = 0; page < 20; page++) {
      const result = openAiPage.parse(await getJson(url, { Authorization: `Bearer ${key}` }));
      for (const item of result.data) {
        const totals = new Map<string, number>();
        for (const row of item.results) {
          const unit = row.amount.currency.toUpperCase();
          if (unit !== "USD") throw new Error("unsupported_currency");
          totals.set(unit, (totals.get(unit) ?? 0) + row.amount.value);
        }
        for (const [unit, amount] of totals) output.push(toCost(dayFromUnix(item.start_time), dayFromUnix(item.end_time), "OpenAI API", unit, amount * 100));
      }
      if (!result.has_more) return output;
      if (!result.next_page || url.searchParams.get("page") === result.next_page) break;
      url.searchParams.set("page", result.next_page);
    }
    throw new Error("vendor_pagination");
  } };
}

export function anthropicConnector(key: string): CostConnector {
  return { provider: "anthropic", async syncCosts({ start, end }) {
    const url = new URL("https://api.anthropic.com/v1/organizations/cost_report");
    url.search = new URLSearchParams({ starting_at: start + "T00:00:00Z", ending_at: end + "T00:00:00Z", bucket_width: "1d", limit: "31" }).toString();
    const output: ProviderCost[] = [];
    for (let page = 0; page < 20; page++) {
      const result = anthropicPage.parse(await getJson(url, { "x-api-key": key, "anthropic-version": "2023-06-01" }));
      for (const item of result.data) {
        if (item.results.length) output.push(toCost(item.starting_at.slice(0, 10), item.ending_at.slice(0, 10), "Anthropic API", "USD",
          item.results.reduce((sum, row) => sum + row.amount, 0)));
      }
      if (!result.has_more) return output;
      if (!result.next_page || url.searchParams.get("page") === result.next_page) break;
      url.searchParams.set("page", result.next_page);
    }
    throw new Error("vendor_pagination");
  } };
}

const githubResponse = z.object({
  usageItems: z.array(z.object({ date: z.iso.date(), netAmount: decimal })),
});

export function githubConnector(key: string): CostConnector {
  return { provider: "github", async syncCosts({ start, end, account }) {
    if (!/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(account)) throw new Error("invalid_github_org");
    const url = new URL(`https://api.github.com/organizations/${account}/settings/billing/usage`);
    const month = start.slice(0, 7);
    url.search = new URLSearchParams({ year: month.slice(0, 4), month: String(Number(month.slice(5))) }).toString();
    const result = githubResponse.parse(await getJson(url, {
      Authorization: `Bearer ${key}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
    }));
    const totals = new Map<string, number>();
    for (const row of result.usageItems) {
      if (row.date >= start && row.date < end) totals.set(row.date, (totals.get(row.date) ?? 0) + row.netAmount);
    }
    return [...totals].map(([day, amount]) => toCost(day,
      new Date(Date.parse(day + "T00:00:00Z") + 86400000).toISOString().slice(0, 10), "GitHub usage billing", "USD", amount * 100));
  } };
}

export function connectors() {
  const items = new Map<string, CostConnector>();
  if (process.env.OPENAI_ADMIN_KEY) items.set("openai", openAiConnector(process.env.OPENAI_ADMIN_KEY));
  if (process.env.ANTHROPIC_ADMIN_KEY) items.set("anthropic", anthropicConnector(process.env.ANTHROPIC_ADMIN_KEY));
  if (process.env.GITHUB_BILLING_TOKEN) items.set("github", githubConnector(process.env.GITHUB_BILLING_TOKEN));
  if (process.env.VERCEL_BILLING_TOKEN) items.set("vercel", vercelConnector(process.env.VERCEL_BILLING_TOKEN));
  const google = googleBillingConfig();
  if (google) items.set("google-cloud", googleBillingConnector(google));
  return items;
}
export const adapterProviders = new Set<string>(["openai", "anthropic", "github", "google-cloud", "vercel"]);
