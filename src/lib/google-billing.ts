import { JWT } from "google-auth-library";
import { z } from "zod";
import type { CostConnector } from "./connectors";

const projectName = /^[a-z][a-z0-9-]{4,29}$/;
const tableName = /^[a-z][a-z0-9-]{4,29}\.[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*$/;
const skuName = /^[a-z0-9]+(?:-[a-z0-9]+){1,5}$/i;
const locationName = /^[a-z][a-z0-9-]{1,30}$/i;
const authSchema = z.object({ client_email: z.email(), private_key: z.string().startsWith("-----BEGIN PRIVATE KEY-----") });

type Config = {
  project: string; table: string; location: string; skus: string[];
  credentials: { client_email: string; private_key: string };
  maximumBytes: string;
};

export function googleBillingConfig(): Config | undefined {
  const { GCP_BILLING_JOB_PROJECT, GCP_BILLING_TABLE, GCP_BILLING_LOCATION, GCP_GEMINI_SKU_IDS, GCP_BILLING_CREDENTIALS, GCP_BILLING_MAX_BYTES } = process.env;
  if (!GCP_BILLING_JOB_PROJECT || !projectName.test(GCP_BILLING_JOB_PROJECT) || !GCP_BILLING_TABLE || !tableName.test(GCP_BILLING_TABLE) ||
      !GCP_BILLING_LOCATION || !locationName.test(GCP_BILLING_LOCATION) || !GCP_GEMINI_SKU_IDS || !GCP_BILLING_CREDENTIALS ||
      !GCP_BILLING_MAX_BYTES || !/^[1-9][0-9]{5,10}$/.test(GCP_BILLING_MAX_BYTES)) return undefined;
  const skus = GCP_GEMINI_SKU_IDS.split(",").map(sku => sku.trim());
  if (skus.length > 50 || !skus.every(sku => skuName.test(sku))) return undefined;
  try {
    const credentials = authSchema.parse(JSON.parse(GCP_BILLING_CREDENTIALS));
    return { credentials, project: GCP_BILLING_JOB_PROJECT, table: GCP_BILLING_TABLE, location: GCP_BILLING_LOCATION, skus, maximumBytes: GCP_BILLING_MAX_BYTES };
  } catch {
    return undefined;
  }
}

const queryResult = z.object({
  jobComplete: z.boolean(), pageToken: z.string().min(1).max(2048).optional(),
  jobReference: z.object({ jobId: z.string().regex(/^[A-Za-z0-9_-]{1,1024}$/), location: z.string().regex(locationName).optional() }).optional(),
  errors: z.array(z.unknown()).optional(),
  rows: z.array(z.object({ f: z.tuple([z.object({ v: z.iso.date() }), z.object({ v: z.string().regex(/^[A-Z]{3}$/) }), z.object({ v: z.string().regex(/^-?\d+(\.\d+)?$/) })]) })).optional(),
});

export function googleBillingConnector(config: Config): CostConnector {
  return { provider: "google-cloud", async syncCosts({ start, end, account }) {
    if (!projectName.test(account)) throw new Error("vendor_data");
    const client = new JWT({ email: config.credentials.client_email, key: config.credentials.private_key, scopes: ["https://www.googleapis.com/auth/bigquery"] });
    const { token } = await client.getAccessToken();
    if (!token) throw new Error("permission");
    const sql = `SELECT CAST(DATE(usage_start_time, 'Asia/Jerusalem') AS STRING) AS day,
      currency, CAST(SUM(CAST(cost AS NUMERIC) + IFNULL((SELECT SUM(CAST(amount AS NUMERIC)) FROM UNNEST(credits)), 0)) AS STRING) AS net
      FROM \`${config.table}\`
      WHERE project.id = @trackedProject AND sku.id IN UNNEST(@skuIds)
        AND usage_start_time >= TIMESTAMP(@startDate, 'Asia/Jerusalem')
        AND usage_start_time < TIMESTAMP(@endDate, 'Asia/Jerusalem')
      GROUP BY day, currency ORDER BY day, currency`;
    const queryParameters = [
      { name: "trackedProject", parameterType: { type: "STRING" }, parameterValue: { value: account } },
      { name: "startDate", parameterType: { type: "DATE" }, parameterValue: { value: start } },
      { name: "endDate", parameterType: { type: "DATE" }, parameterValue: { value: end } },
      { name: "skuIds", parameterType: { type: "ARRAY", arrayType: { type: "STRING" } }, parameterValue: { arrayValues: config.skus.map(value => ({ value })) } },
    ];
    const endpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${config.project}/queries`;
    const signal = AbortSignal.timeout(25_000);
    const send = async (url: string, options: RequestInit = {}) => {
      const response = await fetch(url, {
        ...options, redirect: "error", cache: "no-store", signal,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "permission" : "vendor_request");
      const result = queryResult.parse(await response.json());
      if (result.errors?.length) throw new Error("vendor_data");
      return result;
    };
    let page = await send(endpoint, { method: "POST",
      body: JSON.stringify({ query: sql, useLegacySql: false, maximumBytesBilled: config.maximumBytes, location: config.location, timeoutMs: 9000, queryParameters }),
    });
    const job = page.jobReference;
    const seen = new Set<string>();
    const rows: NonNullable<typeof page.rows> = [];
    for (let attempt = 0; attempt < 9; attempt++) {
      if (page.jobComplete) rows.push(...(page.rows ?? []));
      if (page.jobComplete && !page.pageToken) break;
      if (!job || attempt === 8 || (page.pageToken && seen.has(page.pageToken))) throw new Error("vendor_data");
      const params = new URLSearchParams({ location: job.location ?? config.location, timeoutMs: "3000" });
      if (page.pageToken) {
        seen.add(page.pageToken);
        params.set("pageToken", page.pageToken);
      }
      page = await send(`${endpoint}/${job.jobId}?${params}`);
    }
    return rows.map(({ f: [{ v: day }, { v: currency }, { v: net }] }) => {
      const next = new Date(Date.parse(day + "T00:00:00Z") + 86_400_000).toISOString().slice(0, 10);
      const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
      const value = Number(net);
      const minor = Math.sign(value) * Math.round(Math.abs(value) * 10 ** digits);
      return { key: `${day}:${next}:${currency}`, start: day, end: next, label: "Gemini API · Google Cloud Billing", currency, minor };
    });
  } };
}
