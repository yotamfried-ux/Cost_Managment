import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { authConfig, readSession } from "./auth";
import { emptyData, LedgerRepository, storageConfig } from "./repository";

export const sessionCookie = "d2r_session";

export function signInModes() {
  const auth = authConfig();
  return {
    shared: Boolean(auth?.shared),
    passwordOnly: auth?.shared?.role === "owner",
    personal: Boolean(auth?.accounts.length && storageConfig()),
  };
}

export const workspace = cache(async () => {
  const storage = storageConfig();
  const auth = authConfig();
  if (!auth) return null;
  const request = await cookies();
  const accounts = storage ? [...auth.accounts] : [];
  const session = readSession(auth.key, auth.shared ? [...accounts, auth.shared] : accounts, request.get(sessionCookie)?.value ?? "");
  if (!session) return null;
  const ledger = storage ? new LedgerRepository(storage) : null;
  const data = ledger ? await ledger.read() : emptyData();
  return { user: { email: session.email }, role: session.role, data, ledger };
});

export async function requireWorkspace() {
  const access = await workspace();
  if (!access) redirect("/sign-in");
  return access;
}
