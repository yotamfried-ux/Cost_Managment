import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

export function isConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY);
}

export async function database() {
  const jar = await cookies();
  return createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (updates) => {
        updates.forEach(({ name, value, options }) => jar.set(name, value, { ...options, httpOnly: true, sameSite: "lax" }));
      },
    },
  });
}

export const workspace = cache(async () => {
  if (!isConfigured()) return null;
  const db = await database();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;
  const { data: level } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (level?.currentLevel !== "aal2") return { mfa: true as const };
  const { data: memberships, error } = await db.from("memberships").select("organization_id,role").eq("user_id", user.id).order("organization_id").limit(1);
  if (error) throw new Error("Workspace lookup failed");
  if (!memberships?.[0]) return { missing: true as const };
  const { organization_id: id, role } = memberships[0];
  return { db, user, id: id as string, role: role as string };
});

export async function requireWorkspace() {
  const access = await workspace();
  if (!access || "missing" in access) redirect("/sign-in");
  if ("mfa" in access) redirect("/mfa");
  return access;
}
