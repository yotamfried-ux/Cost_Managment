import { Shell } from "@/components/shell";
import { normalizeCrm } from "@/lib/business";
import { ownerAttention } from "@/lib/owner-attention";
import { currentTime } from "@/lib/publishing";
import { requireWorkspace } from "@/lib/session";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { data, user, ledger } = await requireWorkspace();
  const initials = user.email.charAt(0).toUpperCase();
  const crm = normalizeCrm(structuredClone(data.crm));
  const open = ownerAttention({ crm, unallocatedMinor: null, upcomingCharges: 0, nowMs: currentTime() });
  const count = (id: string) => open.find(item => item.id === id)?.count ?? 0;
  const badges = { "/approvals": count("approve") + count("fix"), "/outputs": count("decide") };
  return <Shell initials={initials} notifications={(crm.acks.alerts && crm.acks.alerts === data.alerts[0]?.id ? 0 : data.alerts.length) + badges["/approvals"] + badges["/outputs"]} badges={badges}>{!ledger && <p className="notice" role="status">אחסון הנתונים טרם חובר. מוצגת סביבת עבודה ריקה לצפייה בלבד.</p>}{children}</Shell>;
}
