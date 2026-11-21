import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { authConfig, readSession } from "./auth";
import { LedgerRepository, storageConfig } from "./repository";

export const sessionCookie = "d2r_session";

export function isConfigured() {
  return Boolean(storageConfig() && authConfig());
}

export const workspace = cache(async () => {
  const storage = storageConfig();
  const auth = authConfig();
  if (!storage || !auth) return null;
  const request = await cookies();
  const session = readSession(auth.key, auth.accounts, request.get(sessionCookie)?.value ?? "");
  if (!session) return null;
  const ledger = new LedgerRepository(storage);
  const data = await ledger.read();
  return { user: { email: session.email }, role: session.role, data, ledger };
});

export async function requireWorkspace() {
  const access = await workspace();
  if (!access) redirect("/sign-in");
  return access;
}
