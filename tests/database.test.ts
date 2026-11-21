import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const org = "a0000000-0000-4000-8000-000000000001";
const otherOrg = "a0000000-0000-4000-8000-000000000002";
const editor = "a0000000-0000-4000-8000-000000000003";
const viewer = "a0000000-0000-4000-8000-000000000004";
const supplier = "a0000000-0000-4000-8000-000000000005";
const project = "a0000000-0000-4000-8000-000000000006";
const request = "a0000000-0000-4000-8000-000000000007";
const account = "a0000000-0000-4000-8000-000000000008";
const digest = "f".repeat(64);

test("Postgres policies, provenance, FX, invoice reconciliation and ingest idempotency", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema auth to authenticated;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit integer,allowed_mime_types text[]);
    create table storage.objects(bucket_id text,name text,primary key(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated;
    grant select,insert on storage.objects to authenticated;
  `);
  const path = new URL("../supabase/migrations/", import.meta.url);
  for (const name of (await readdir(path)).sort()) await db.exec(await readFile(new URL(name, path), "utf8"));
  await db.exec(`
    insert into auth.users values ('${editor}'),('${viewer}');
    insert into public.organizations(id,name) values('${org}','Fixture'),('${otherOrg}','Unrelated');
    insert into public.memberships values('${org}','${editor}','editor'),('${org}','${viewer}','viewer');
    insert into public.projects(id,organization_id,name) values('${project}','${org}','Fixture project');
    insert into public.suppliers(id,organization_id,name,category) values('${supplier}','${org}','Fixture supplier','cloud');
    insert into public.provider_accounts(id,organization_id,provider,external_account_id,supplier_id) values('${account}','${org}','openai','fixture','${supplier}');
  `);
  async function login(user: string, aal: string) {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user, aal })]);
  }
  const create = () => db.query<{ id: string }>("select public.create_manual_charge($1,$2,'FX item','cloud',1590,'USD','estimate','2026-11-19',$3,$4) as id",
    [org, request, supplier, project]);
  await login(editor, "aal1");
  assert.equal((await db.query("select * from public.projects")).rows.length, 0);
  await assert.rejects(create(), /not authorized/);
  await login(viewer, "aal2");
  assert.equal((await db.query("select * from public.projects")).rows.length, 1);
  await assert.rejects(create(), /not authorized/);
  await login(editor, "aal2");
  assert.equal((await db.query("select * from public.organizations where id=$1", [otherOrg])).rows.length, 0);
  const charge = (await create()).rows[0].id;
  assert.equal((await create()).rows[0].id, charge);
  await assert.rejects(db.query("update public.audit_log set before_row=null"), /permission denied/);
  await db.query("select public.apply_charge_rate($1,$2,'3.5','2026-11-18','fixture rate')", [org, charge]);
  await db.query("insert into storage.objects values('d2r-invoices',$1)", [org + "/" + digest + ".pdf"]);
  const source = () => db.query<{ id: string }>("select public.register_invoice($1,$2,'TEST-1','2026-11-20',1590,'USD',$3,'file.pdf') as id", [org, supplier, digest]);
  const invoice = (await source()).rows[0].id;
  assert.equal((await source()).rows[0].id, invoice);
  await db.query("select public.match_invoice($1,$2,$3)", [org, invoice, charge]);
  const report = await db.query<{ report: { evidence: { name: string; total: number }[]; projects: { total: number }[] } }>(
    "select public.finance_summary($1,'2026-11-01','2026-12-01',null) as report", [org]);
  assert.equal(report.rows[0].report.evidence[0].name, "verified");
  assert.equal(report.rows[0].report.evidence[0].total, 5565);
  assert.equal(report.rows[0].report.projects[0].total, 5565);
  await db.exec("reset role; set role service_role;");
  const event = { minor: 100, label: "fixture", currency: "USD", start: "2026-11-01", end: "2026-11-02" };
  for (let attempt = 0; attempt < 2; attempt++) await db.query("select public.ingest_provider_cost($1,'cost-v1',$2,$3)", [account, digest, event]);
  await db.exec("reset role");
  assert.equal((await db.query("select * from public.cost_events")).rows.length, 1);
  const charges = await db.query("select * from public.charges");
  assert.equal(charges.rows.length, 2);
  assert.equal((await db.query("select * from storage.buckets where public")).rows.length, 0);
});
