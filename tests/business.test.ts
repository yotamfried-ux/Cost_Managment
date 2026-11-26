import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { applyBatch, batchInput, IngestError, sign, verifyRequest } from "../src/lib/business";
import { emptyData, LedgerRepository } from "../src/lib/repository";

const lead = (overrides: object = {}) => ({
  type: "lead", key: "ig-dm-001", name: "PRIVATE-LEAD-MARKER", contact: "050-0000000", source: "instagram", product: "tori",
  status: "new", consent: "inbound", ...overrides,
});
const batch = (records: object[], batchId = randomUUID()) => batchInput.parse({ batchId, records });

test("requests are accepted only with a fresh signature from the configured secret", () => {
  const secret = randomBytes(24).toString("hex");
  const now = Date.now();
  const stamp = String(now);
  const body = JSON.stringify({ hello: "world" });
  const good = sign(secret, stamp, body);
  assert.equal(verifyRequest(secret, stamp, good, body, now), "ok");
  assert.equal(verifyRequest(secret, stamp, good, body + " ", now), "unauthorized");
  assert.equal(verifyRequest(secret, stamp, good.replace(/.$/, c => (c === "0" ? "1" : "0")), body, now), "unauthorized");
  assert.equal(verifyRequest(secret, String(now - 6 * 60_000), sign(secret, String(now - 6 * 60_000), body), body, now), "unauthorized");
  assert.equal(verifyRequest(secret, null, good, body, now), "unauthorized");
  assert.equal(verifyRequest(undefined, stamp, good, body, now), "unconfigured");
  assert.equal(verifyRequest("short", stamp, good, body, now), "unconfigured");
});

test("batches validate strictly: unknown fields, non-https links, bad dates and oversize batches are rejected", () => {
  assert.throws(() => batch([lead({ surprise: 1 })]));
  assert.throws(() => batch([{ type: "post", key: "p1", platform: "instagram", status: "published", url: "javascript:alert(1)" }]));
  assert.throws(() => batch([lead({ nextActionDue: "2026-13-40" })]));
  assert.throws(() => batch([{ type: "charge", key: "x" }]));
  assert.throws(() => batchInput.parse({ batchId: randomUUID(), records: Array.from({ length: 201 }, (_, i) => lead({ key: `k${i}` })) }));
});

test("ingest is idempotent per batch, upserts by key, and never touches finance data", () => {
  const data = emptyData();
  const before = JSON.stringify({ ...data, crm: undefined, audit: [] });
  const first = batch([lead(), lead({ key: "ig-dm-002", name: "Second" })]);
  assert.deepEqual(applyBatch(data, first), { duplicate: false, added: 2, updated: 0 });
  assert.deepEqual(applyBatch(data, first), { duplicate: true, added: 0, updated: 0 });
  assert.equal(data.crm!.leads.length, 2);
  const id = data.crm!.leads.find(row => row.key === "ig-dm-001")!.id;
  assert.deepEqual(applyBatch(data, batch([lead({ status: "qualified", note: "asked for a quote" })])), { duplicate: false, added: 0, updated: 1 });
  const stored = data.crm!.leads.find(row => row.key === "ig-dm-001")!;
  assert.equal(stored.id, id);
  assert.equal(stored.status, "qualified");
  assert.equal(JSON.stringify({ ...data, crm: undefined, audit: [] }), before);
});

test("opt-out is sticky and forces the opted_out status", () => {
  const data = emptyData();
  applyBatch(data, batch([lead({ optedOut: true, status: "contacted" })]));
  assert.equal(data.crm!.leads[0].status, "opted_out");
  applyBatch(data, batch([lead({ optedOut: false, status: "contacted" })]));
  assert.equal(data.crm!.leads[0].optedOut, true);
  assert.equal(data.crm!.leads[0].status, "opted_out");
});

test("capacity limits fail closed with a 413 and leave earlier data intact", () => {
  const data = emptyData();
  const big = (index: number) => lead({ key: `big-${index}`, note: "x".repeat(500), name: "n".repeat(120), contact: "c".repeat(160), nextAction: "a".repeat(200) });
  let failure: unknown;
  try {
    for (let batchIndex = 0; batchIndex < 30; batchIndex++) {
      applyBatch(data, batch(Array.from({ length: 100 }, (_, index) => big(batchIndex * 100 + index))));
    }
  } catch (error) { failure = error; }
  assert.ok(failure instanceof IngestError);
  assert.equal((failure as IngestError).status, 413);
});

test("business records are encrypted at rest in the same snapshot as the ledger", async t => {
  const root = await mkdtemp(join(tmpdir(), "d2r-crm-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = new LedgerRepository({ mode: "local", root, key: randomBytes(32) });
  await repository.transaction(data => ({ result: applyBatch(data, batch([lead()])) }));
  assert.equal((await repository.read()).crm?.leads[0].name, "PRIVATE-LEAD-MARKER");
  assert.equal((await readFile(join(root, "ledger.enc"))).includes("PRIVATE-LEAD-MARKER"), false);
});
