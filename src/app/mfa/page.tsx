import { redirect } from "next/navigation";
import { database, isConfigured } from "@/lib/session";
import { Brand } from "@/components/brand";
import { signOut } from "../auth-actions";
import { MfaForm } from "./mfa-form";

export default async function Mfa() {
  if (!isConfigured()) redirect("/sign-in");
  const db = await database();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/sign-in");
  const { data: level } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (level?.currentLevel === "aal2") redirect("/");
  const { data } = await db.auth.mfa.listFactors();
  const factor = data?.totp.find(item => item.status === "verified");
  return <main className="auth-shell"><section className="panel auth-card">
    <Brand /><h1>אימות דו-שלבי</h1><MfaForm factorId={factor?.id} />
    <form action={signOut} className="auth-exit"><button className="button">יציאה</button></form>
  </section></main>;
}
