"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createHash } from "node:crypto";
import { z } from "zod";
import { LedgerRepository, storageConfig } from "@/lib/repository";
import { authConfig, issueSession, sessionDuration, verifyPassword, verifyTotp } from "@/lib/auth";
import { sessionCookie } from "@/lib/session";

const attempts = new Map<string, { expires: number; count: number }>();

function allowAttempt(ip: string, email: string) {
  const now = Date.now();
  for (const [key, entry] of attempts) if (entry.expires <= now) attempts.delete(key);
  if (attempts.size > 5000) return false;
  const normalize = (key: string) => createHash("sha256").update(key).digest("hex");
  const counters = [normalize("ip:" + ip), normalize("account:" + email)].map(key => {
    const record = attempts.get(key) ?? { count: 0, expires: now + 60_000 };
    attempts.set(key, record);
    return record;
  });
  if (counters[0].count >= 15 || counters[1].count >= 8) return false;
  counters.forEach(record => record.count++);
  return true;
}

export async function signIn(form: FormData) {
  const storage = storageConfig();
  const auth = authConfig();
  if (!storage || !auth) redirect("/sign-in?error=config");
  const values = z.object({
    email: z.email().max(254).transform(value => value.toLowerCase()), password: z.string().min(1).max(200), code: z.string().regex(/^\d{6}$/),
  }).safeParse({ email: form.get("email"), password: form.get("password"), code: form.get("code") });
  if (!values.success) redirect("/sign-in?error=auth");
  const request = await headers();
  const ip = request.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowAttempt(ip, values.data.email)) redirect("/sign-in?error=rate");
  const account = auth.accounts.find(row => row.email === values.data.email);
  if (!(await verifyPassword(values.data.password, account)) || !account) redirect("/sign-in?error=auth");
  const step = verifyTotp(account.totpSecret, values.data.code);
  if (step === undefined) redirect("/sign-in?error=auth");
  const key = createHash("sha256").update(account.email + ":" + account.totpSecret).digest("hex");
  let consumed: boolean;
  try {
    consumed = await new LedgerRepository(storage).transaction(data => {
      const last = data.lastTotp[key] ?? -1;
      if (last >= step) return { result: false, changed: false };
      data.lastTotp[key] = step;
      return { result: true };
    });
  } catch {
    redirect("/sign-in?error=storage");
  }
  if (!consumed) redirect("/sign-in?error=used");
  (await cookies()).set(sessionCookie, issueSession(auth.key, account), {
    secure: Boolean(process.env.VERCEL), httpOnly: true, sameSite: "lax", path: "/", maxAge: sessionDuration,
  });
  redirect("/");
}

export async function signOut() {
  (await cookies()).delete(sessionCookie);
  redirect("/sign-in");
}
