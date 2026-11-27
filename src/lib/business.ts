import { createHash, createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import { constantEqual } from "./auth";
import { audit } from "./ledger";
import type { WorkspaceData } from "./repository";

/*
 * Business data written by the Director agent (leads, customers, marketing). It lives inside the same encrypted
 * snapshot as the ledger, so it is bounded to keep finance writes safe. The agent can only reach this module
 * through the signed ingest route; it has no path to charges, invoices or credentials.
 */

export const leadStatuses = ["new", "contacted", "replied", "qualified", "quote_sent", "won", "lost", "opted_out"] as const;
export const leadStatusLabels: Record<(typeof leadStatuses)[number], string> = {
  new: "חדש", contacted: "נוצר קשר", replied: "ענה", qualified: "מתאים", quote_sent: "נשלחה הצעה", won: "נסגר", lost: "לא נסגר", opted_out: "ביקש הסרה",
};
export const consentLabels = { none: "ללא", inbound: "פנה בעצמו", opt_in: "אישר קבלת פרסום" } as const;
export const platforms = ["instagram", "facebook", "whatsapp", "linkedin", "site"] as const;
export const platformLabels: Record<(typeof platforms)[number], string> = {
  instagram: "Instagram", facebook: "Facebook", whatsapp: "WhatsApp", linkedin: "LinkedIn", site: "אתר",
};

export const publicationStatuses = ["pending", "approved", "rejected", "publishing", "published", "failed", "expired"] as const;
export type PublicationStatus = (typeof publicationStatuses)[number];
export const publicationLabels: Record<PublicationStatus, string> = {
  pending: "ממתין לאישור", approved: "מאושר", rejected: "נדחה", publishing: "בפרסום", published: "פורסם", failed: "נכשל", expired: "פג תוקף",
};
export const agentStatuses = ["proposed", "active", "paused"] as const;
/** Media may only be pulled from these GitHub hosts (the same ones the page is allowed to play from), so an agent can never point the publisher at an arbitrary server. */
export const mediaHosts = ["raw.githubusercontent.com", "media.githubusercontent.com"] as const;

const text = (max: number) => z.string().trim().max(max);
export const recordKey = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_.-]{0,79}$/);
const key = recordKey;
const day = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
const count = z.number().int().min(0).max(1_000_000_000).optional();
const link = z.string().max(300).refine(value => { try { return new URL(value).protocol === "https:"; } catch { return false; } }, "https only");

export const leadInput = z.object({
  type: z.literal("lead"), key, name: text(120), contact: text(160).default(""), source: text(60), product: text(60).default(""),
  status: z.enum(leadStatuses), consent: z.enum(["none", "inbound", "opt_in"]), optedOut: z.boolean().default(false),
  nextAction: text(200).default(""), nextActionDue: day.nullable().default(null), valueMinor: z.number().int().min(0).max(1e10).nullable().default(null),
  currency: z.string().regex(/^[A-Z]{3}$/).default("ILS"), note: text(500).default(""), createdOn: day.optional(),
}).strict();
export const customerInput = z.object({
  type: z.literal("customer"), key, name: text(120), contact: text(160).default(""), products: z.array(text(60)).max(10).default([]),
  status: z.enum(["active", "paused", "churned"]), since: day.nullable().default(null), leadKey: key.nullable().default(null), note: text(500).default(""),
}).strict();
export const postInput = z.object({
  type: z.literal("post"), key, platform: z.enum(platforms), product: text(60).default(""), status: z.enum(["draft", "approved", "published"]),
  publishedOn: day.nullable().default(null), url: link.nullable().default(null), format: text(40).default(""), hook: text(200).default(""), pillar: text(60).default(""),
}).strict();
export const metricInput = z.object({
  type: z.literal("metric"), key, date: day, platform: z.enum(platforms), product: text(60).default(""), postKey: key.nullable().default(null),
  views: count, reach: count, likes: count, comments: count, saves: count, shares: count, clicks: count, follows: count,
}).strict();
export const runInput = z.object({ type: z.literal("run"), key, agent: text(40).default(""), routine: text(60), summary: text(500), at: z.iso.datetime() }).strict();
export const agentInput = z.object({
  type: z.literal("agent"), key, name: text(80), job: text(200).default(""), cadence: text(80).default(""), status: z.enum(agentStatuses),
}).strict();
/** A plain-language summary of an agent's run for the business owner: what was found, what is recommended, what needs a decision. */
export const digestInput = z.object({
  type: z.literal("digest"), key, agent: text(40), title: text(120), summary: text(600), decision: text(300).default(""),
  items: z.array(z.object({ title: text(120), detail: text(300).default(""), link: link.nullable().default(null), tag: text(30).default("") }).strict()).max(10).default([]),
  at: z.iso.datetime(),
}).strict();
const mediaLink = link.refine(value => (mediaHosts as readonly string[]).includes(new URL(value).hostname), "media host not allowed");
/** A post proposed by the agent. It carries no approval fields: only a signed-in owner can approve, and only the publisher can publish. */
export const publicationInput = z.object({
  type: z.literal("publication"), key, posterUrl: mediaLink.nullable().default(null), platforms: z.array(z.enum(["instagram", "facebook"])).min(1).max(2).refine(list => new Set(list).size === list.length),
  product: text(60).default(""), slot: text(20).default(""), publishAt: z.iso.datetime(),
  captionIg: text(2200).default(""), captionFb: text(2200).default(""), fileUrl: mediaLink, fileName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/),
  format: text(40).default("reel"), hook: text(200).default(""), note: text(500).default(""),
}).strict().refine(post => (!post.platforms.includes("instagram") || post.captionIg.length > 0) && (!post.platforms.includes("facebook") || post.captionFb.length > 0), "caption missing for a selected platform");
export const recordInput = z.discriminatedUnion("type", [leadInput, customerInput, postInput, metricInput, runInput, agentInput, publicationInput, digestInput]);
export const batchInput = z.object({ batchId: z.uuid(), records: z.array(recordInput).min(1).max(200) }).strict();
export type Batch = z.infer<typeof batchInput>;

type WithId<T> = T & { id: string; updatedAt: string };
export type Lead = WithId<Omit<z.infer<typeof leadInput>, "type" | "createdOn">> & { createdOn: string };
export type Customer = WithId<Omit<z.infer<typeof customerInput>, "type">>;
export type Post = WithId<Omit<z.infer<typeof postInput>, "type">>;
export type Metric = WithId<Omit<z.infer<typeof metricInput>, "type">>;
export type AgentRun = Omit<z.infer<typeof runInput>, "type"> & { id: string };
export type Agent = WithId<Omit<z.infer<typeof agentInput>, "type">>;
export type Digest = WithId<Omit<z.infer<typeof digestInput>, "type">>;
export type Publication = WithId<Omit<z.infer<typeof publicationInput>, "type">> & {
  status: PublicationStatus; hash: string; approvedAt: string | null; approvedBy: string | null; claimedAt: string | null; finishedAt: string | null;
  igMediaId: string | null; fbPostId: string | null; result: string;
};
export type CrmData = { leads: Lead[]; customers: Customer[]; posts: Post[]; metrics: Metric[]; runs: AgentRun[]; batches: string[]; agents: Agent[]; publications: Publication[]; digests: Digest[] };

export function emptyCrm(): CrmData { return { leads: [], customers: [], posts: [], metrics: [], runs: [], batches: [], agents: [], publications: [], digests: [] }; }
/** Snapshots written before agents and publications existed lack those arrays; fill them in place. */
export function normalizeCrm(crm: Partial<CrmData> | undefined): CrmData {
  const base = emptyCrm();
  const target = (crm ?? base) as CrmData;
  for (const name of Object.keys(base) as (keyof CrmData)[]) (target as Record<string, unknown>)[name] ??= base[name];
  return target;
}

/** What the owner approves is exactly this content; the publisher re-checks it before claiming. */
export function publicationHash(post: Pick<Publication, "key" | "posterUrl" | "platforms" | "slot" | "publishAt" | "captionIg" | "captionFb" | "fileUrl" | "fileName">) {
  return createHash("sha256").update(JSON.stringify([post.key, post.posterUrl, [...post.platforms].sort(), post.slot, post.publishAt, post.captionIg, post.captionFb, post.fileUrl, post.fileName])).digest("hex");
}

const limits = { leads: 5000, customers: 2000, posts: 1500, metrics: 6000, runs: 100, batches: 200, agents: 20, publications: 300, digests: 100 } as const;
const finishedStatuses: PublicationStatus[] = ["published", "rejected", "expired", "failed"];
const retainMs = 30 * 86_400_000;

function upsertPublication(crm: CrmData, fields: Omit<z.infer<typeof publicationInput>, "type">, now: string) {
  const existing = crm.publications.find(row => row.key === fields.key);
  // Once approved (or later) the content is frozen: the agent can neither edit nor re-open it.
  if (existing && existing.status !== "pending") return "locked" as const;
  const content = { ...fields, hash: publicationHash(fields) };
  if (!existing) {
    crm.publications.unshift({ ...content, id: randomUUID(), updatedAt: now, status: "pending", approvedAt: null, approvedBy: null, claimedAt: null, finishedAt: null, igMediaId: null, fbPostId: null, result: "" });
    return "added" as const;
  }
  Object.assign(existing, content, { updatedAt: now });
  return "updated" as const;
}
export const maxCrmBytes = 450_000;

export class IngestError extends Error {
  constructor(message: string, readonly status: 400 | 413) { super(message); }
}

function upsert<T extends { key: string; id: string; updatedAt: string }>(rows: T[], incoming: Omit<T, "id" | "updatedAt">, now: string, merge?: (old: T, next: T) => T) {
  const existing = rows.find(row => row.key === incoming.key);
  if (!existing) { rows.unshift({ ...incoming, id: randomUUID(), updatedAt: now } as T); return "added" as const; }
  const next = { ...incoming, id: existing.id, updatedAt: now } as T;
  Object.assign(existing, merge ? merge(existing, next) : next);
  return "updated" as const;
}

export function applyBatch(data: WorkspaceData, batch: Batch, now = new Date().toISOString()) {
  const crm = data.crm = normalizeCrm(data.crm);
  if (crm.batches.includes(batch.batchId)) return { duplicate: true, added: 0, updated: 0 };
  let added = 0, updated = 0, locked = 0;
  for (const record of batch.records) {
    const { type, ...fields } = record;
    let outcome: "added" | "updated";
    if (record.type === "publication") {
      const result = upsertPublication(crm, fields as Omit<z.infer<typeof publicationInput>, "type">, now);
      if (result === "locked") locked++; else if (result === "added") added++; else updated++;
      continue;
    }
    if (type === "lead") {
      const lead = fields as z.infer<typeof leadInput>;
      outcome = upsert<Lead>(crm.leads, { ...lead, createdOn: lead.createdOn ?? now.slice(0, 10) }, now, (old, next) => {
        // Opt-out is sticky: a later batch can never silently re-enable contact.
        const optedOut = old.optedOut || next.optedOut;
        return { ...next, createdOn: old.createdOn, optedOut, status: optedOut ? "opted_out" : next.status };
      });
      const stored = crm.leads.find(row => row.key === lead.key);
      if (stored && stored.optedOut) stored.status = "opted_out";
    } else if (type === "customer") outcome = upsert<Customer>(crm.customers, fields as never, now);
    else if (type === "post") outcome = upsert<Post>(crm.posts, fields as never, now);
    else if (type === "metric") outcome = upsert<Metric>(crm.metrics, fields as never, now);
    else if (type === "agent") outcome = upsert<Agent>(crm.agents, fields as never, now);
    else if (type === "digest") outcome = upsert<Digest>(crm.digests, fields as never, now);
    else {
      const run = fields as z.infer<typeof runInput>;
      const existing = crm.runs.find(row => row.key === run.key);
      if (existing) { Object.assign(existing, run); outcome = "updated"; } else { crm.runs.unshift({ ...run, id: randomUUID() }); outcome = "added"; }
    }
    if (outcome === "added") added++; else updated++;
  }
  crm.digests = crm.digests.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60);
  const cutoff = new Date(Date.parse(now) - retainMs).toISOString();
  crm.publications = crm.publications.filter(row => !(finishedStatuses.includes(row.status) && row.publishAt < cutoff));
  for (const name of ["leads", "customers", "posts", "metrics", "agents", "publications"] as const) {
    if (crm[name].length > limits[name]) throw new IngestError(`${name} capacity exceeded`, 413);
  }
  crm.runs = crm.runs.slice(0, limits.runs);
  crm.batches = [batch.batchId, ...crm.batches].slice(0, limits.batches);
  if (Buffer.byteLength(JSON.stringify(crm)) > maxCrmBytes) throw new IngestError("business data capacity exceeded", 413);
  audit(data, "agent", "business_batch", "INSERT", { batchId: batch.batchId, added, updated, ...(locked ? { locked } : {}) });
  return { duplicate: false, added, updated, ...(locked ? { locked } : {}) };
}

export const maxBody = 150_000;
export const maxClockSkewMs = 5 * 60_000;

/** Signature over `${timestamp}.${rawBody}`; the secret never leaves the server and the agent holds a separate scoped secret. */
export function sign(secret: string, timestamp: string, body: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}
export function verifyRequest(secret: string | undefined, timestamp: string | null, signature: string | null, body: string, now = Date.now()) {
  if (!secret || secret.length < 32) return "unconfigured" as const;
  if (!timestamp || !signature || !/^\d{13}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > maxClockSkewMs) return "unauthorized" as const;
  return constantEqual(signature, sign(secret, timestamp, body)) ? "ok" as const : "unauthorized" as const;
}
