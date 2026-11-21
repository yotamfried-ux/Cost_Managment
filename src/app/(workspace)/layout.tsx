import { Shell } from "@/components/shell";
import { requireWorkspace } from "@/lib/session";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { db, id, user } = await requireWorkspace();
  const { count, error } = await db.from("notifications").select("id", { count: "exact", head: true }).eq("organization_id", id);
  if (error) throw new Error("Notifications unavailable");
  const initials = user.email?.charAt(0).toUpperCase() ?? "D";
  return <Shell initials={initials} notifications={count ?? 0}>{children}</Shell>;
}
