import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { signInModes, workspace } from "@/lib/session";
import { signIn, signInShared } from "../auth-actions";

const messages: Record<string, string> = {
  auth: "לא ניתן להתחבר עם הפרטים שהוזנו.",
  rate: "בוצעו יותר מדי ניסיונות. נסו שוב בעוד דקה.",
  used: "קוד האימות כבר שימש לכניסה. המתינו לקוד הבא.",
  storage: "הגישה לסביבת העבודה אינה זמינה כרגע.",
};

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [{ error }, session] = await Promise.all([searchParams, workspace()]);
  if (session) redirect("/");
  const { shared, personal } = signInModes();
  return <main className="auth-shell"><section className="panel auth-card">
    <Brand /><h1>כניסה לסביבת העבודה</h1>
    {!shared && !personal && <p className="notice" role="status">מערכת ההתחברות ממתינה להגדרת גישה לסביבת העבודה.</p>}
    {error && (shared || personal) && <p className="notice" role="alert">{messages[error] ?? messages.auth}</p>}
    {shared && <form action={signInShared} className="field-stack" aria-label="כניסה עם סיסמה משותפת">
      <label>סיסמה<input name="password" type="password" dir="ltr" autoComplete="current-password" required /></label>
      <Remember checked />
      <button className="button primary">כניסה</button>
    </form>}
    {personal && <form action={signIn} className="field-stack" aria-label="כניסה לחשבון אישי">
      {shared && <h2>כניסה לחשבון אישי</h2>}
      <label>דואר אלקטרוני<input name="email" type="email" dir="ltr" autoComplete="username" required /></label>
      <label>סיסמת חשבון<input name="password" type="password" dir="ltr" autoComplete="current-password" required /></label>
      <label>קוד אימות<input name="code" dir="ltr" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required /></label>
      <Remember />
      <button className="button primary">{shared ? "כניסה לחשבון" : "כניסה"}</button>
    </form>}
  </section></main>;
}

function Remember({ checked = false }: { checked?: boolean }) {
  return <label className="remember-device"><input type="checkbox" name="remember" defaultChecked={checked} />זכור אותי בדפדפן הזה ל־30 יום</label>;
}
