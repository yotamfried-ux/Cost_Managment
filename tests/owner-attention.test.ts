import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyCrm, type CrmData } from "../src/lib/business";
import { cadenceLabel, ownerAttention } from "../src/lib/owner-attention";

const now = Date.parse("2026-11-30T10:00:00Z");
const post = (status: string, publishAt: string, claimedAt: string | null = null) => ({ id: status + publishAt, key: status + publishAt, status, publishAt, claimedAt }) as unknown as CrmData["publications"][number];

test("attention lists only what a person must act on, most urgent first", () => {
  const crm = emptyCrm();
  assert.deepEqual(ownerAttention({ crm, unallocatedMinor: null, upcomingCharges: 0, nowMs: now }), []);
  crm.publications.push(post("pending", "2026-12-01T05:45:00Z"), post("pending", "2026-11-29T05:45:00Z"), post("failed", "2026-11-29T05:45:00Z"), post("publishing", "2026-11-30T09:00:00Z", "2026-11-30T09:00:00Z"));
  crm.digests.push({ id: "1", key: "a", agent: "sales", title: "t", summary: "s", decision: "לאשר?", items: [], at: "2026-11-30T08:00:00Z", updatedAt: "" }, { id: "2", key: "b", agent: "sales", title: "t", summary: "s", decision: "", items: [], at: "2026-11-30T09:00:00Z", updatedAt: "" });
  const items = ownerAttention({ crm, unallocatedMinor: 1000, upcomingCharges: 2, nowMs: now });
  assert.deepEqual(items.map(item => [item.id, item.count]), [["approve", 1], ["fix", 2], ["assign", 1], ["charges", 2]]);
});

test("a question the agent has since answered itself no longer counts", () => {
  const crm = emptyCrm();
  crm.digests.push({ id: "1", key: "a", agent: "sales", title: "t", summary: "s", decision: "לאשר?", items: [], at: "2026-11-30T08:00:00Z", updatedAt: "" });
  assert.equal(ownerAttention({ crm, unallocatedMinor: 0, upcomingCharges: 0, nowMs: now })[0].id, "decide");
});

test("a dismissed item stays hidden until what it is about changes; posts to approve cannot be dismissed", () => {
  const crm = emptyCrm();
  crm.publications.push(post("pending", "2026-12-01T05:45:00Z"));
  crm.digests.push({ id: "1", key: "a", agent: "sales", title: "t", summary: "s", decision: "לאשר?", items: [], at: "2026-11-30T08:00:00Z", updatedAt: "" });
  const input = { crm, unallocatedMinor: 500, upcomingCharges: 2, nowMs: now };
  const fingerprints = Object.fromEntries(ownerAttention(input).map(item => [item.id, item.fingerprint]));
  crm.acks = { ...fingerprints, approve: "", assign: fingerprints.assign };
  assert.deepEqual(ownerAttention(input).map(item => item.id), ["approve"]);
  // A newer summary from the agent brings the decision back.
  crm.digests.push({ id: "2", key: "b", agent: "sales", title: "t2", summary: "s", decision: "עוד שאלה", items: [], at: "2026-11-30T09:00:00Z", updatedAt: "" });
  assert.ok(ownerAttention(input).some(item => item.id === "decide"));
  // A different unallocated amount brings that one back too.
  assert.ok(ownerAttention({ ...input, unallocatedMinor: 900 }).some(item => item.id === "assign"));
});

test("cron expressions become plain Hebrew", () => {
  assert.equal(cadenceLabel("cron 47 9 * * 4"), "כל יום חמישי ב־09:47");
  assert.equal(cadenceLabel("cron 23 16 * * *"), "כל יום ב־16:23");
  assert.equal(cadenceLabel("לפי אירוע"), "כשיש ליד חדש או כשמבקשים ממנו");
  assert.equal(cadenceLabel("every full moon"), "every full moon");
});
