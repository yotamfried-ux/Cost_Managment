import type { CrmData } from "./business";
import { lateMs, stuckMs } from "./publishing";

export type Attention = { id: "approve" | "fix" | "decide" | "assign" | "charges"; count: number; href: string; tone: "coral" | "mint" };
export type AttentionInput = { crm: CrmData; unallocatedMinor: number | null; upcomingCharges: number; nowMs: number };

/** What needs the owner today, most urgent first. Only things a person must act on; nothing is invented. */
export function ownerAttention({ crm, unallocatedMinor, upcomingCharges, nowMs }: AttentionInput): Attention[] {
  const waiting = crm.publications.filter(row => row.status === "pending" && Date.parse(row.publishAt) > nowMs).length;
  const broken = crm.publications.filter(row => row.status === "failed"
    || (row.status === "publishing" && row.claimedAt !== null && nowMs - Date.parse(row.claimedAt) > stuckMs)
    || (row.status === "approved" && nowMs - Date.parse(row.publishAt) > lateMs)).length;
  const latest = new Map<string, CrmData["digests"][number]>();
  for (const row of [...crm.digests].sort((a, b) => a.at.localeCompare(b.at))) latest.set(row.agent, row);
  const decisions = [...latest.values()].filter(row => row.decision).length;
  const items: Attention[] = [
    { id: "approve", count: waiting, href: "/approvals", tone: "coral" },
    { id: "fix", count: broken, href: "/approvals", tone: "coral" },
    { id: "decide", count: decisions, href: "/outputs", tone: "coral" },
    { id: "assign", count: (unallocatedMinor ?? 0) > 0 ? 1 : 0, href: "/expenses?project=unassigned", tone: "mint" },
    { id: "charges", count: upcomingCharges, href: "/suppliers", tone: "mint" },
  ];
  return items.filter(item => item.count > 0);
}

export const attentionText = (item: Attention, unallocated: string) => ({
  approve: `${item.count} פוסטים ממתינים לאישור שלך`,
  fix: `${item.count} פוסטים נכשלו או נתקעו ודורשים טיפול`,
  decide: `${item.count} סוכנים שואלים אותך שאלה ומחכים להחלטה`,
  assign: `הוצאות בסך ${unallocated} עדיין לא משויכות לפרויקט`,
  charges: `${item.count} חיובים צפויים ב־14 הימים הקרובים`,
}[item.id]);

/** Plain-Hebrew labels for agents, whatever English the agent sent as its job. */
const agentNames: Record<string, { name: string; job: string }> = {
  marketing: { name: "שיווק", job: "מכין כל יום אחר הצהריים את שלושת הפוסטים של מחר ואת הסרטונים, ומסיק מסקנות מהנתונים של הרשתות." },
  "projects-scout": { name: "איתור פרויקטים", job: "מחפש פרויקטים בשכר שאפשר לקחת וצרכים שחוזרים אצל כמה עסקים, כדי לבנות פעם אחת ולמכור כמה פעמים." },
  "product-customers": { name: "לקוחות למוצרים", job: "מחפש עסקים שיכולים לשלם על מוצרים שכבר בנית, ומכין טיוטת פנייה לאישורך." },
  sales: { name: "מכירות", job: "מטפל בליד מהפנייה ועד ההחלטה: מיון, מענה, מעקב, הצעת מחיר." },
  auditor: { name: "בקרה", job: "בודק את עבודת כל הסוכנים, את תור האישורים ואת הסוכנים התקועים, ובשבוע חוקר דרכים לשפר את העבודה." },
};
export const agentLabel = (key: string, name: string, job: string) => agentNames[key] ?? { name, job };

const days = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
/** "cron 47 9 * * 4" -> "כל יום חמישי ב־09:47". Anything not understood is returned as sent. */
export function cadenceLabel(cadence: string): string {
  const match = /^cron (\d{1,2}) (\d{1,2}) \* \* (\*|[0-6])$/.exec(cadence.trim());
  if (!match) return cadence === "לפי אירוע" ? "כשיש ליד חדש או כשמבקשים ממנו" : cadence || "—";
  const [, minute, hour, day] = match;
  const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  return day === "*" ? `כל יום ב־${time}` : `כל יום ${days[Number(day)]} ב־${time}`;
}
