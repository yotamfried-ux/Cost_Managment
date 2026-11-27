import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { applyBatch, batchInput, publicationHash } from "../src/lib/business";
import { claimDue, israelDay, queueRequest, reportPublication, reviewPublications } from "../src/lib/publishing";
import { emptyData } from "../src/lib/repository";

const slotTime = "2026-12-01T05:45:00.000Z";
const at = (offsetMinutes: number, base = slotTime) => new Date(Date.parse(base) + offsetMinutes * 60_000).toISOString();
const publication = (overrides: object = {}) => ({
  type: "publication", key: "2026-12-01-a", platforms: ["instagram", "facebook"], product: "tori", slot: "A", publishAt: slotTime,
  captionIg: "PRIVATE-CAPTION-MARKER תורים בלי הודעות", captionFb: "טקסט לפייסבוק", fileUrl: "https://raw.githubusercontent.com/yotamfried-ux/Director/media-assets/a.mp4",
  fileName: "a.mp4", format: "reel", hook: "פחות הודעות", ...overrides,
});
const ingest = (data = emptyData(), records: object[] = [publication()], now = at(-24 * 60)) => {
  applyBatch(data, batchInput.parse({ batchId: randomUUID(), records }), now);
  return data;
};
const approved = (data = ingest(), key = "2026-12-01-a") => {
  assert.deepEqual(reviewPublications(data, [key], "approve", "owner@d2r.test", at(-60)), { done: 1, skipped: 0 });
  return data;
};

test("the agent can only propose: approval fields, other hosts and incomplete captions are rejected", () => {
  assert.throws(() => batchInput.parse({ batchId: randomUUID(), records: [publication({ status: "approved" })] }));
  assert.throws(() => batchInput.parse({ batchId: randomUUID(), records: [publication({ approvedBy: "agent" })] }));
  assert.throws(() => batchInput.parse({ batchId: randomUUID(), records: [publication({ fileUrl: "https://evil.example/a.mp4" })] }));
  assert.throws(() => batchInput.parse({ batchId: randomUUID(), records: [publication({ fileUrl: "http://raw.githubusercontent.com/a.mp4" })] }));
  assert.throws(() => batchInput.parse({ batchId: randomUUID(), records: [publication({ fileName: "../a.mp4" })] }));
  assert.throws(() => batchInput.parse({ batchId: randomUUID(), records: [publication({ captionFb: "" })] }));
  assert.throws(() => batchInput.parse({ batchId: randomUUID(), records: [publication({ platforms: ["instagram", "instagram"] })] }));
  assert.throws(() => batchInput.parse({ batchId: randomUUID(), records: [publication({ publishAt: "tomorrow" })] }));
});

test("a proposed post starts pending with a content hash; edits are allowed only while pending", () => {
  const data = ingest();
  const [post] = data.crm!.publications;
  assert.equal(post.status, "pending");
  assert.equal(post.hash, publicationHash(post));
  const firstHash = post.hash;
  ingest(data, [publication({ captionIg: "טקסט מתוקן" })]);
  assert.equal(data.crm!.publications.length, 1);
  assert.equal(data.crm!.publications[0].captionIg, "טקסט מתוקן");
  assert.notEqual(data.crm!.publications[0].hash, firstHash);
});

test("approval is owner-recorded, binds the content, and freezes it against further agent edits", () => {
  const data = approved();
  const post = data.crm!.publications[0];
  assert.equal(post.status, "approved");
  assert.equal(post.approvedBy, "owner@d2r.test");
  const result = applyBatch(data, batchInput.parse({ batchId: randomUUID(), records: [publication({ captionIg: "החלפה אחרי אישור", publishAt: at(300) })] }), at(-30));
  assert.equal(result.locked, 1);
  assert.equal(data.crm!.publications[0].captionIg.includes("PRIVATE-CAPTION-MARKER"), true);
  assert.equal(data.crm!.publications[0].publishAt, slotTime);
  assert.equal(JSON.stringify(data.audit).includes("PRIVATE-CAPTION-MARKER"), false);
});

test("a post can only be approved while pending and before its time; rejection is final", () => {
  const data = ingest();
  assert.deepEqual(reviewPublications(data, ["missing-key"], "approve", "owner@d2r.test", at(-60)), { done: 0, skipped: 1 });
  assert.deepEqual(reviewPublications(data, ["2026-12-01-a"], "approve", "owner@d2r.test", at(1)), { done: 0, skipped: 1 });
  assert.equal(data.crm!.publications[0].status, "pending");
  assert.deepEqual(reviewPublications(data, ["2026-12-01-a"], "reject", "owner@d2r.test", at(-60)), { done: 1, skipped: 0 });
  assert.deepEqual(reviewPublications(data, ["2026-12-01-a"], "approve", "owner@d2r.test", at(-59)), { done: 0, skipped: 1 });
  assert.equal(data.crm!.publications[0].status, "rejected");
});

test("approval of tampered content is refused", () => {
  const data = ingest();
  data.crm!.publications[0].captionIg = "שונה ישירות בלי לחשב hash מחדש";
  assert.deepEqual(reviewPublications(data, ["2026-12-01-a"], "approve", "owner@d2r.test", at(-60)), { done: 0, skipped: 1 });
});

test("the publisher gets only approved posts that are due, once, and within two hours", () => {
  const data = ingest(emptyData(), [publication(), publication({ key: "2026-12-01-b", slot: "B", publishAt: at(405) })]);
  assert.equal(claimDue(data, at(1)).item, null);
  approved(data);
  assert.equal(claimDue(data, at(-5)).item, null);
  const first = claimDue(data, at(1));
  assert.equal(first.item?.key, "2026-12-01-a");
  assert.equal(first.item?.fileName, "a.mp4");
  assert.equal(data.crm!.publications.find(row => row.key === "2026-12-01-a")!.status, "publishing");
  assert.equal(claimDue(data, at(2)).item, null);
  assert.equal(data.crm!.publications.find(row => row.key === "2026-12-01-b")!.status, "pending");
});

test("an approval that was not picked up within two hours expires instead of publishing late", () => {
  const data = approved();
  const outcome = claimDue(data, at(121));
  assert.equal(outcome.item, null);
  assert.equal(outcome.changed, true);
  assert.equal(data.crm!.publications[0].status, "expired");
});

test("a post whose content no longer matches its approval is never handed out", () => {
  const data = approved();
  data.crm!.publications[0].fileUrl = "https://raw.githubusercontent.com/yotamfried-ux/Director/media-assets/other.mp4";
  assert.equal(claimDue(data, at(1)).item, null);
  assert.equal(data.crm!.publications[0].status, "failed");
});

test("the publisher reports once; a published post creates marketing records per platform", () => {
  const data = approved();
  assert.deepEqual(reportPublication(data, { action: "report", key: "2026-12-01-a", outcome: "published", igMediaId: null, fbPostId: null, note: "" }, at(3)), { ok: false, reason: "not_publishing" });
  claimDue(data, at(1));
  const report = queueRequest.parse({ action: "report", key: "2026-12-01-a", outcome: "published", igMediaId: "17900000000000001", fbPostId: "1401748436362661_123456", note: "ok" });
  assert.equal(report.action, "report");
  assert.deepEqual(reportPublication(data, report as never, at(3)), { ok: true });
  assert.equal(data.crm!.publications[0].status, "published");
  assert.equal(data.crm!.publications[0].igMediaId, "17900000000000001");
  assert.deepEqual(data.crm!.posts.map(row => row.key).sort(), ["2026-12-01-a:facebook", "2026-12-01-a:instagram"]);
  assert.equal(data.crm!.posts[0].publishedOn, israelDay(at(3)));
  assert.equal(reportPublication(data, report as never, at(4)).ok, false);
});

test("queue requests are strict", () => {
  assert.throws(() => queueRequest.parse({ action: "claim", extra: 1 }));
  assert.throws(() => queueRequest.parse({ action: "approve", key: "x" }));
  assert.throws(() => queueRequest.parse({ action: "report", key: "k1", outcome: "published", igMediaId: "abc" }));
  assert.deepEqual(queueRequest.parse({ action: "claim" }), { action: "claim" });
});

test("agent roster records and run attribution are stored; finished posts older than 30 days are pruned", () => {
  const data = ingest(emptyData(), [
    { type: "agent", key: "marketing", name: "שיווק", job: "פוסטים", cadence: "כל יום", status: "active" },
    { type: "run", key: "r1", agent: "marketing", routine: "daily", summary: "הוכנו 3 פוסטים", at: at(0) },
  ]);
  assert.equal(data.crm!.agents[0].status, "active");
  assert.equal(data.crm!.runs[0].agent, "marketing");
  const old = ingest(emptyData(), [publication()], at(-24 * 60));
  old.crm!.publications[0].status = "published";
  ingest(old, [publication({ key: "later", publishAt: at(60 * 24 * 40) })], at(60 * 24 * 40 - 60));
  assert.equal(old.crm!.publications.some(row => row.key === "2026-12-01-a"), false);
});

test("the poster is part of what gets approved, and only GitHub media hosts are accepted", () => {
  const data = ingest(emptyData(), [publication({ posterUrl: "https://raw.githubusercontent.com/yotamfried-ux/Director/media-assets/a.webp" })]);
  const post = data.crm!.publications[0];
  assert.equal(post.hash, publicationHash(post));
  assert.notEqual(publicationHash({ ...post, posterUrl: null }), post.hash);
  assert.throws(() => batchInput.parse({ batchId: randomUUID(), records: [publication({ posterUrl: "https://evil.example/a.webp" })] }));
  assert.throws(() => batchInput.parse({ batchId: randomUUID(), records: [publication({ fileUrl: "https://github.com/yotamfried-ux/Director/raw/a.mp4" })] }));
});

test("agent digests are validated strictly, replaced by key, and kept to the latest 60", () => {
  const digest = (key: string, at: string, extra: object = {}) => ({ type: "digest", key, agent: "marketing", title: "סיכום " + key, summary: "מה שנעשה", at, ...extra });
  assert.throws(() => batchInput.parse({ batchId: randomUUID(), records: [digest("d", at(0), { surprise: 1 })] }));
  assert.throws(() => batchInput.parse({ batchId: randomUUID(), records: [digest("d", at(0), { items: [{ title: "x", link: "http://insecure.example" }] })] }));
  assert.throws(() => batchInput.parse({ batchId: randomUUID(), records: [digest("d", at(0), { items: Array.from({ length: 11 }, () => ({ title: "x" })) })] }));
  const data = ingest(emptyData(), [digest("d1", at(0), { decision: "לאשר פוסט?", items: [{ title: "פריט", detail: "פרט", link: "https://example.test/x", tag: "מומלץ" }] })]);
  ingest(data, [digest("d1", at(5), { summary: "עודכן" })]);
  assert.equal(data.crm!.digests.length, 1);
  assert.equal(data.crm!.digests[0].summary, "עודכן");
  for (let batch = 0; batch < 2; batch++) ingest(data, Array.from({ length: 40 }, (_, index) => digest(`m${batch}-${index}`, at(10 + batch * 40 + index))));
  assert.equal(data.crm!.digests.length, 60);
  assert.equal(data.crm!.digests.some(row => row.key === "d1"), false);
});
