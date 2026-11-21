import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { encodeBase32, issueSession, passwordHash, readSession, totp, verifyPassword, verifyTotp } from "../src/lib/auth";
import { applyExchangeRate, assertWriter, ingestCost, matchInvoice } from "../src/lib/ledger";
import { storedWebhookInbox } from "../src/lib/plugins";
import { LedgerRepository, type Charge } from "../src/lib/repository";

test("signed MFA sessions reject invalid passwords, changed permissions, tampering and expiry", async () => {
  const account = {
    email: "owner@d2r.test", role: "owner" as const, passwordHash: await passwordHash("fixture-password"),
    totpSecret: encodeBase32(randomBytes(20)),
  };
  const key = randomBytes(32);
  assert.equal(await verifyPassword("bad", account), false);
  assert.equal(await verifyPassword("fixture-password", account), true);
  const step = Math.floor(Date.now() / 30_000);
  assert.equal(verifyTotp(account.totpSecret, totp(account.totpSecret, step), step), step);
  const session = issueSession(key, account, 1000);
  assert.equal(readSession(key, [account], session, 2000)?.role, "owner");
  assert.equal(readSession(key, [account], session + "a", 2000), undefined);
  assert.equal(readSession(key, [{ ...account, role: "viewer" }], session, 2000), undefined);
  assert.equal(readSession(key, [account], session, 16_000), undefined);
  assert.throws(() => assertWriter("viewer"), /permission/);
});

test("encrypted repository persists concurrent mutations and documents, rejects wrong key, and reconciles idempotently", async t => {
  const root = await mkdtemp(join(tmpdir(), "d2r-store-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const key = randomBytes(32);
  const repository = new LedgerRepository({ mode: "local", root, key });
  assert.equal((await repository.read()).charges.length, 0);
  const invoiceId = randomUUID();
  const pdf = Buffer.from("%PDF-1.4\nCONFIDENTIAL-MARKER\n%%EOF");
  const charge: Charge = {
    id: randomUUID(), request_id: randomUUID(), supplier_id: randomUUID(), description: "PRIVATE-LEDGER-MARKER",
    recorded_on: "2026-11-18", amount_minor: 1590, currency: "USD", category: "cloud", evidence: "estimate",
    source: "manual", project_id: null, amount_ils_minor: null, invoice_id: null,
  };
  applyExchangeRate(charge, { quote: "3.5", quoted: "2026-11-18", source: "fixture" });
  assert.equal(charge.amount_ils_minor, 5565);
  await Promise.all([
    repository.transaction(data => {
      data.charges.push(charge);
      return { result: null };
    }),
    repository.transaction(data => {
      data.invoices.push({
        id: invoiceId, issued_on: "2026-11-18", invoice_number: "invoice-1", original_name: "fixture.pdf", amount_minor: 1590,
        currency: "USD", status: "review", supplier_id: charge.supplier_id!, sha256: "e".repeat(64),
      });
      return { result: null, document: { id: invoiceId, bytes: pdf } };
    }),
  ]);
  assert.equal((await repository.read()).charges.length, 1);
  assert.deepEqual(await repository.document(invoiceId), pdf);
  assert.equal((await readFile(join(root, "ledger.enc"))).includes("PRIVATE-LEDGER-MARKER"), false);
  assert.equal((await readFile(join(root, "documents", invoiceId + ".enc"))).includes("CONFIDENTIAL-MARKER"), false);
  await assert.rejects(new LedgerRepository({ mode: "local", root, key: randomBytes(32) }).read());
  await repository.transaction(data => {
    assert.equal(matchInvoice(data, "owner", invoiceId, charge.id), true);
    assert.equal(matchInvoice(data, "owner", invoiceId, charge.id), false);
    const account = { id: randomUUID(), supplier_id: charge.supplier_id!, provider: "openai", external_account_id: "fixture", last_synced_at: null };
    data.accounts.push(account);
    const event = { key: "period", start: "2026-11-01", end: "2026-11-02", label: "API", minor: 100, currency: "USD" };
    assert.equal(ingestCost(data, account.id, event), true);
    assert.equal(ingestCost(data, account.id, event), false);
    assert.equal(ingestCost(data, account.id, { ...event, minor: 110 }), true);
    return { result: null };
  });
  const inbox = storedWebhookInbox(repository);
  const scope = { organizationId: "fixture", kind: "invoice" as const, providerId: "adapter" };
  const event = { id: "invoice-event", resourceId: invoiceId, type: "fixture", occurredAt: "2026-11-20T10:00:00Z" };
  const queued = await Promise.all([inbox.enqueueOnce(scope, event),inbox.enqueueOnce(scope, event)]);
  assert.deepEqual(queued.sort(), [false,true]);
  const data = await repository.read();
  assert.equal(data.charges.length, 2);
  assert.equal(data.charges[0].amount_minor, 110);
  assert.equal(data.charges[1].evidence, "verified");
  assert.equal(data.costEvents.length, 2);
});

test("Git storage uses non-forced ref updates and encrypts both blobs", async t => {
  const input = Buffer.from("SECRET INVOICE TEXT");
  const calls: string[] = [];
  let head = "a".repeat(40);
  let ledgerBlob: string | undefined;
  let latestBlob: string | undefined;
  let updates = 0;
  const ref = (hex: string) => ({ sha: hex.repeat(40) });
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(new URL(url).hostname, "api.github.com");
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer fixture");
    const route = url.split("/Cost_Managment/")[1];
    calls.push(init.method + " " + route);
    const payload = init.body ? JSON.parse(String(init.body)) : {};
    if (init.method === "GET" && route === "git/ref/heads/d2r-data") return Response.json({ object: { sha: head } });
    if (route.startsWith("contents/ledger.enc")) {
      return ledgerBlob ? Response.json({ ...ref("b"), size: Buffer.from(ledgerBlob,"base64").length, encoding: "base64", content: ledgerBlob }) : new Response(null,{status:404});
    }
    if (init.method === "GET" && route.startsWith("git/commits/")) return Response.json({ tree: ref("c") });
    if (route === "git/blobs") {
      const blob = Buffer.from(payload.content, "base64");
      assert.equal(blob.subarray(0,4).toString(), "D2R1");
      assert.equal(blob.includes(input), false);
      if (blob.length > 64) latestBlob = payload.content;
      return Response.json(ref("b"));
    }
    if (route === "git/trees") {
      assert.equal(payload.tree[0].path,"ledger.enc");
      assert.equal(payload.tree.length,2);
      return Response.json(ref("d"));
    }
    if (route === "git/commits") {
      assert.deepEqual(payload.parents,[head]);
      assert.equal(payload.message,"Update encrypted workspace");
      return Response.json(ref("e"));
    }
    if (init.method === "PATCH" && route === "git/refs/heads/d2r-data") {
      assert.equal(payload.force,false);
      if (updates++ === 0) {
        head = "f".repeat(40);
        return new Response(null,{ status:422 });
      }
      head = payload.sha;
      ledgerBlob = latestBlob;
      return Response.json({ object: { sha: head } });
    }
    throw new Error("Unexpected API route: " + route);
  });
  const store = new LedgerRepository({ mode: "git", key: randomBytes(32), token: "fixture" });
  const id = randomUUID();
  await store.transaction(data => {
    data.business.name = "private test business";
    return { result: true, document: { id, bytes: input } };
  });
  assert.equal((await store.read()).business.name,"private test business");
  assert.equal(calls.filter(path => path.startsWith("PATCH")).length,2);
});
