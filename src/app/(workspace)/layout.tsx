import { Shell } from "@/components/shell";
import { requireWorkspace } from "@/lib/session";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { data, user, ledger } = await requireWorkspace();
  const initials = user.email.charAt(0).toUpperCase();
  return <Shell initials={initials} notifications={data.alerts.length}>{!ledger && <p className="notice" role="status">אחסון הנתונים טרם חובר. מוצגת סביבת עבודה ריקה לצפייה בלבד.</p>}{children}</Shell>;
}
