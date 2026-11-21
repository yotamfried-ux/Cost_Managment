import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { isConfigured, workspace } from "@/lib/session";
import { signIn, signOut } from "../auth-actions";

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [{ error }, session] = await Promise.all([searchParams, workspace()]);
  if (session && session.id) redirect("/");
  if (session && "mfa" in session) redirect("/mfa");
  const configured = isConfigured();
  return <main className="auth-shell"><section className="panel auth-card">
    <Brand /><h1>כניסה לסביבת העבודה</h1>
    {session && "missing" in session ? <>
      <p role="status">לחשבון זה טרם הוקצתה הרשאה לסביבת עבודה.</p>
      <form action={signOut}><button className="button">יציאה</button></form>
    </> : <form action={signIn} className="field-stack">
      {!configured && <p className="notice" role="status">מערכת ההתחברות ממתינה לחיבור לסביבת נתונים.</p>}
      {error && configured && <p className="notice" role="alert">לא ניתן להתחבר עם הפרטים שהוזנו.</p>}
      <label>דואר אלקטרוני<input name="email" type="email" dir="ltr" autoComplete="username" required disabled={!configured} /></label>
      <label>סיסמה<input name="password" type="password" dir="ltr" autoComplete="current-password" required disabled={!configured} /></label>
      <button className="button primary" disabled={!configured}>כניסה</button>
    </form>}
  </section></main>;
}
