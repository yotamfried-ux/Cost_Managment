import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { isConfigured, workspace } from "@/lib/session";
import { signIn } from "../auth-actions";

const messages: Record<string, string> = {
  auth: "לא ניתן להתחבר עם הפרטים שהוזנו.",
  rate: "בוצעו יותר מדי ניסיונות. נסו שוב בעוד דקה.",
  used: "קוד האימות כבר שימש לכניסה. המתינו לקוד הבא.",
  storage: "הגישה לסביבת העבודה אינה זמינה כרגע.",
};

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [{ error }, session] = await Promise.all([searchParams, workspace()]);
  if (session) redirect("/");
  const configured = isConfigured();
  return <main className="auth-shell"><section className="panel auth-card">
    <Brand /><h1>כניסה לסביבת העבודה</h1>
    <form action={signIn} className="field-stack">
      {!configured && <p className="notice" role="status">מערכת ההתחברות ממתינה להגדרת גישה לסביבת העבודה.</p>}
      {error && configured && <p className="notice" role="alert">{messages[error] ?? messages.auth}</p>}
      <label>דואר אלקטרוני<input name="email" type="email" dir="ltr" autoComplete="username" required disabled={!configured} /></label>
      <label>סיסמה<input name="password" type="password" dir="ltr" autoComplete="current-password" required disabled={!configured} /></label>
      <label>קוד אימות<input name="code" dir="ltr" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required disabled={!configured} /></label>
      <button className="button primary" disabled={!configured}>כניסה</button>
    </form>
  </section></main>;
}
