import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit } from "./ledger";
import { normalizeCrm, publicationHash, recordKey, type Publication } from "./business";
import type { WorkspaceData } from "./repository";

/*
 * Approval and publishing queue. The agent proposes posts (status "pending"); only a signed-in owner can approve them;
 * only the publisher (n8n, holding its own secret) can claim an approved post once its slot arrives and report the result.
 * Approval is bound to a content hash, so text, file and time cannot change between the click and the publish.
 */

export const lapseMs = 2 * 3_600_000;
export const stuckMs = 30 * 60_000;
export const lateMs = 10 * 60_000;
export const maxQueueBody = 4_000;
/** Wrapped so views can read the clock without calling an impure function during render. */
export const currentTime = () => Date.now();

const platformPost = { instagram: "instagram", facebook: "facebook" } as const;

/** Calendar day in Israel, used to group the three posts of one day. */
export const israelDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date(iso));

export function reviewPublications(data: WorkspaceData, keys: string[], decision: "approve" | "reject" | "cancel", actor: string, now = new Date().toISOString()) {
  const crm = data.crm = normalizeCrm(data.crm);
  let done = 0, skipped = 0;
  for (const key of new Set(keys)) {
    const post = crm.publications.find(row => row.key === key);
    // Only a pending post whose content still matches its hash and whose time has not passed can be approved.
    const approvable = post && post.status === "pending" && post.hash === publicationHash(post) && post.publishAt > now;
    // An approval can be withdrawn only while the post is still waiting for its slot: once the publisher has claimed it, it may already be live.
    const cancellable = post && post.status === "approved" && post.publishAt > now;
    const allowed = decision === "approve" ? approvable : decision === "cancel" ? cancellable : post && post.status === "pending";
    if (!allowed) { skipped++; continue; }
    const before = { key, status: post!.status };
    post!.status = decision === "approve" ? "approved" : "rejected";
    post!.updatedAt = now;
    if (decision === "approve") { post!.approvedAt = now; post!.approvedBy = actor; }
    else { post!.finishedAt = now; if (decision === "cancel") post!.result = `האישור בוטל על ידי ${actor} לפני הפרסום`; }
    audit(data, actor, "publication", "UPDATE", { key, status: post!.status, hash: post!.hash, publishAt: post!.publishAt }, before);
    done++;
  }
  return { done, skipped };
}

export type Claimed = { key: string; platforms: Publication["platforms"]; captionIg: string; captionFb: string; fileUrl: string; fileName: string; slot: string; publishAt: string };

/** Hands the publisher the next approved post that is due and still inside its two-hour window. */
export function claimDue(data: WorkspaceData, now = new Date().toISOString()): { item: Claimed | null; changed: boolean } {
  const crm = data.crm = normalizeCrm(data.crm);
  let changed = false;
  const earliest = new Date(Date.parse(now) - lapseMs).toISOString();
  for (const post of crm.publications) {
    if (post.status === "approved" && post.publishAt < earliest) {
      post.status = "expired"; post.finishedAt = now; post.updatedAt = now; post.result = "לא פורסם תוך שעתיים מהמועד, האישור פג";
      audit(data, "publisher", "publication", "UPDATE", { key: post.key, status: "expired" });
      changed = true;
    }
  }
  const due = crm.publications.filter(row => row.status === "approved" && row.publishAt <= now).sort((a, b) => a.publishAt.localeCompare(b.publishAt))[0];
  if (!due) return { item: null, changed };
  if (!due.approvedAt || !due.approvedBy || due.hash !== publicationHash(due)) {
    // Content or approval record no longer matches what was approved: never publish it.
    due.status = "failed"; due.finishedAt = now; due.updatedAt = now; due.result = "התוכן שונה אחרי האישור, לא פורסם";
    audit(data, "publisher", "publication", "UPDATE", { key: due.key, status: "failed", reason: "hash_mismatch" });
    return { item: null, changed: true };
  }
  due.status = "publishing"; due.claimedAt = now; due.updatedAt = now;
  audit(data, "publisher", "publication", "UPDATE", { key: due.key, status: "publishing" });
  const { key, platforms, captionIg, captionFb, fileUrl, fileName, slot, publishAt } = due;
  return { item: { key, platforms, captionIg, captionFb, fileUrl, fileName, slot, publishAt }, changed: true };
}

export const queueRequest = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim") }).strict(),
  z.object({
    action: z.literal("report"), key: recordKey, outcome: z.enum(["published", "failed"]),
    igMediaId: z.string().regex(/^\d{5,30}$/).nullable().default(null), fbPostId: z.string().regex(/^[0-9_]{5,60}$/).nullable().default(null),
    note: z.string().trim().max(300).default(""),
  }).strict(),
]);
export type Report = Extract<z.infer<typeof queueRequest>, { action: "report" }>;

/** Records what the publisher did. Only a post it claimed can be reported, and only once. */
export function reportPublication(data: WorkspaceData, report: Report, now = new Date().toISOString()) {
  const crm = data.crm = normalizeCrm(data.crm);
  const post = crm.publications.find(row => row.key === report.key);
  if (!post || post.status !== "publishing") return { ok: false as const, reason: "not_publishing" as const };
  post.status = report.outcome; post.finishedAt = now; post.updatedAt = now;
  post.igMediaId = report.igMediaId; post.fbPostId = report.fbPostId; post.result = report.note;
  if (report.outcome === "published") {
    // Marketing metrics attach to these keys: `<publication key>:<platform>`.
    for (const platform of post.platforms) {
      const postKey = `${post.key}:${platformPost[platform]}`;
      const record = { key: postKey, platform, product: post.product, status: "published" as const, publishedOn: israelDay(now), url: null, format: post.format, hook: post.hook, pillar: "" };
      const existing = crm.posts.find(row => row.key === postKey);
      if (existing) Object.assign(existing, record, { updatedAt: now });
      else crm.posts.unshift({ ...record, id: randomUUID(), updatedAt: now });
    }
  }
  audit(data, "publisher", "publication", "UPDATE", { key: post.key, status: post.status });
  return { ok: true as const };
}
