"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { database, isConfigured } from "@/lib/session";

export async function signIn(form: FormData) {
  if (!isConfigured()) redirect("/sign-in?error=config");
  const values = z.object({ email: z.email().max(254), password: z.string().min(1).max(256) }).safeParse({
    email: form.get("email"), password: form.get("password"),
  });
  if (!values.success) redirect("/sign-in?error=auth");
  const db = await database();
  const { error } = await db.auth.signInWithPassword(values.data);
  if (error) redirect("/sign-in?error=auth");
  redirect("/");
}

export async function signOut() {
  if (isConfigured()) {
    const db = await database();
    await db.auth.signOut({ scope: "local" });
  }
  redirect("/sign-in");
}

export async function enrollMfa() {
  if (!isConfigured()) redirect("/sign-in");
  const db = await database();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/sign-in");
  const { data } = await db.auth.mfa.listFactors();
  for (const factor of data?.all ?? []) {
    if (factor.factor_type === "totp" && factor.status === "unverified") await db.auth.mfa.unenroll({ factorId: factor.id });
  }
  const result = await db.auth.mfa.enroll({ factorType: "totp", issuer: "D2R Management" });
  if (result.error) return { error: "לא ניתן להגדיר אימות דו-שלבי" };
  return { id: result.data.id, secret: result.data.totp.secret };
}

export async function verifyMfa(factorId: string, code: string) {
  if (!isConfigured() || !z.uuid().safeParse(factorId).success || !/^\d{6}$/.test(code)) return "קוד אימות לא תקין";
  const db = await database();
  const result = await db.auth.mfa.challengeAndVerify({ factorId, code });
  if (result.error) return "האימות נכשל. בדקו את הקוד ונסו שוב.";
  redirect("/");
}
