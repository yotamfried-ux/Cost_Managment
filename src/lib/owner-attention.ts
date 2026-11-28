import type { CrmData } from "./business";
import { lateMs, stuckMs } from "./publishing";

export type AttentionId = "approve" | "fix" | "decide" | "assign" | "charges";
/** Ids the owner may mark as seen. Posts to approve or fix clear only when someone acts on them. */
export const dismissible: AttentionId[] = ["decide", "assign", "charges"];
export type Attention = { id: AttentionId; count: number; href: string; tone: "coral" | "mint"; fingerprint: string };
export type AttentionInput = { crm: CrmData; unallocatedMinor: number | null; upcomingCharges: number; nowMs: number };

/** What needs the owner today, most urgent first. Only things a person must act on; nothing is invented. */
export function ownerAttention({ crm, unallocatedMinor, upcomingCharges, nowMs }: AttentionInput): Attention[] {
  const waiting = crm.publications.filter(row => row.status === "pending" && Date.parse(row.publishAt) > nowMs).length;
  const broken = crm.publications.filter(row => row.status === "failed"
    || (row.status === "publishing" && row.claimedAt !== null && nowMs - Date.parse(row.claimedAt) > stuckMs)
    || (row.status === "approved" && nowMs - Date.parse(row.publishAt) > lateMs)).length;
  const latest = new Map<string, CrmData["digests"][number]>();
  for (const row of [...crm.digests].sort((a, b) => a.at.localeCompare(b.at))) latest.set(row.agent, row);
  const deciding = [...latest.values()].filter(row => row.decision);
  const decisions = deciding.length;
  const unallocated = (unallocatedMinor ?? 0) > 0 ? 1 : 0;
  const acks = crm.acks ?? {};
  const items: Attention[] = [
    { id: "approve", count: waiting, href: "/approvals", tone: "coral", fingerprint: "" },
    { id: "fix", count: broken, href: "/approvals", tone: "coral", fingerprint: "" },
    // A new summary or a changed amount changes the fingerprint, so a dismissed item comes back when something new needs the owner.
    { id: "decide", count: decisions, href: "/outputs", tone: "coral", fingerprint: deciding.map(row => `${row.agent}@${row.at}`).sort().join("|") },
    { id: "assign", count: unallocated, href: "/projects", tone: "mint", fingerprint: String(unallocatedMinor ?? 0) },
    { id: "charges", count: upcomingCharges, href: "/suppliers", tone: "mint", fingerprint: String(upcomingCharges) },
  ];
  return items.filter(item => item.count > 0 && !(dismissible.includes(item.id) && acks[item.id] === item.fingerprint));
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
