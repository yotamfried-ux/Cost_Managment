import { randomBytes } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const status = spawnSync("npx", ["--yes", "supabase@3.2.0", "status", "-o", "json"], { encoding: "utf8" });
if (status.status !== 0) throw new Error("Local Supabase status failed");
const info = JSON.parse(status.stdout);
const url = info.API_URL;
const publishable = info.PUBLISHABLE_KEY ?? info.ANON_KEY;
const service = info.SECRET_KEY ?? info.SERVICE_ROLE_KEY;
if (!url || new URL(url).hostname !== "127.0.0.1" || !service || !publishable) throw new Error("Refusing to seed nonlocal Supabase");
const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
const password = randomBytes(20).toString("base64url");
const accounts = [];
for (const role of ["owner", "viewer"]) {
  const { data, error } = await admin.auth.admin.createUser({ email: role + "@d2r.test", password, email_confirm: true });
  if (error || !data.user || !/^[\da-f-]{36}$/i.test(data.user.id)) throw new Error("Fixture account setup failed");
  accounts.push([role, data.user.id]);
}
const org = "a0000000-0000-4000-8000-000000000001";
const sql = `
insert into public.organizations(id,name) values ('${org}','סביבת בדיקה מבודדת');
insert into public.memberships (organization_id,user_id,role) values ${accounts.map(([role,id]) => `('${org}','${id}','${role}')`).join(",")};
insert into public.projects(organization_id,name,description) values('${org}','פרויקט בדיקה','פרויקט מקומי לבדיקות');
insert into public.suppliers(organization_id,name,category) values('${org}','ספק בדיקה','כלים עסקיים');
`;
const database = spawnSync("docker", ["exec", "-i", "supabase_db_d2r-management-local", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-d", "postgres"], { input: sql, encoding: "utf8" });
if (database.status !== 0) throw new Error("Fixture database setup failed: " + database.stderr);
if (!process.env.GITHUB_ENV) throw new Error("Fixture requires an environment file destination");
if (process.env.GITHUB_ACTIONS) console.log("::add-mask::" + password);
await appendFile(process.env.GITHUB_ENV,
  `SUPABASE_URL=${url}\nSUPABASE_PUBLISHABLE_KEY=${publishable}\nD2R_TEST_PASSWORD=${password}\n`);
