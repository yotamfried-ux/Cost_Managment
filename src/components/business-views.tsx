import { Activity, CircleCheck, Eye, Megaphone, MousePointerClick, TriangleAlert, UsersRound, UserRoundCheck } from "lucide-react";
import { businessDate, monthOffset, monthTitle } from "@/lib/finance";
import { consentLabels, normalizeCrm, leadStatusLabels, leadStatuses, platformLabels, platforms, type CrmData, type Lead } from "@/lib/business";
import { Blank, Chip, DataTable, displayDate, Metrics, Panel } from "./dashboard";
import { Distribution, Trend } from "./charts";

const number = (value: number) => new Intl.NumberFormat("he-IL").format(value);
const sum = (rows: (number | undefined)[]) => rows.reduce<number>((total, value) => total + (value ?? 0), 0);
const closed = new Set<Lead["status"]>(["won", "lost", "opted_out"]);
const crmOf = (data: { crm?: CrmData }) => normalizeCrm(data.crm ? { ...data.crm } : undefined);
const tone = (status: Lead["status"]) => status === "won" ? "good" : status === "lost" || status === "opted_out" ? "bad" : status === "new" ? "pending" : "neutral";

export function LeadsView({ data, month }: { data: { crm?: CrmData }; month: string }) {
  const crm = crmOf(data);
  const today = businessDate();
  const added = crm.leads.filter(row => row.createdOn.startsWith(month));
  const overdue = crm.leads.filter(row => !closed.has(row.status) && row.nextActionDue !== null && row.nextActionDue < today);
  const funnel = leadStatuses.map(status => ({ name: leadStatusLabels[status], total: crm.leads.filter(row => row.status === status).length })).filter(row => row.total > 0);
  const sources = [...new Set(crm.leads.map(row => row.source))].map(name => ({ name: name || "לא ידוע", total: crm.leads.filter(row => row.source === name).length }));
  const won = crm.leads.filter(row => row.status === "won").length;
  const ordered = [...crm.leads].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 100);
  return <>
    <Metrics metrics={[
      { label: "לידים בחודש", value: number(added.length), detail: monthTitle(month), icon: UsersRound },
      { label: "סך הלידים", value: number(crm.leads.length), detail: "כל התקופות", icon: Activity },
      { label: "נסגרו", value: number(won), detail: crm.leads.length ? `${Math.round(won / crm.leads.length * 100)}% מכלל הלידים` : "אין עדיין לידים", icon: CircleCheck },
      { label: "מעקב באיחור", value: number(overdue.length), detail: "פעולה הבאה שעבר מועדה", icon: TriangleAlert, tone: "coral" },
    ]}/>
    <div className="split charts-row">
      <Panel title="שלבי המשפך"><Distribution rows={funnel} units="number" label="לידים"/></Panel>
      <Panel title="מקורות הלידים"><Distribution rows={sources} units="number" label="לידים"/></Panel>
    </div>
    <Panel title={`לידים אחרונים (${ordered.length}${crm.leads.length > ordered.length ? ` מתוך ${crm.leads.length}` : ""})`}>
      {ordered.length ? <DataTable headings={["שם", "יצירת קשר", "מוצר", "מקור", "סטטוס", "הסכמה", "פעולה הבאה", "ערך"]}>{ordered.map(row => <tr key={row.id}>
        <td>{row.name}</td><td><bdi>{row.contact || "—"}</bdi></td><td>{row.product || "—"}</td><td>{row.source}</td>
        <td><Chip tone={tone(row.status)}>{leadStatusLabels[row.status]}</Chip></td><td>{consentLabels[row.consent]}</td>
        <td>{row.nextAction ? <>{row.nextAction}{row.nextActionDue && <> · {displayDate(row.nextActionDue)}</>}</> : "—"}</td>
        <td>{row.valueMinor === null ? "—" : <bdi>{new Intl.NumberFormat("he-IL", { style: "currency", currency: row.currency, maximumFractionDigits: 0 }).format(row.valueMinor / 100)}</bdi>}</td>
      </tr>)}</DataTable> : <Blank>עוד אין לידים. הם ייקלטו כאן כשסוכן המכירות יופעל. עד אז אין מה לעשות במסך הזה.</Blank>}
    </Panel>
  </>;
}

export function CustomersView({ data }: { data: { crm?: CrmData } }) {
  const crm = crmOf(data);
  const active = crm.customers.filter(row => row.status === "active");
  const byProduct = new Map<string, number>();
  for (const row of active) for (const product of row.products.length ? row.products : ["ללא מוצר"]) byProduct.set(product, (byProduct.get(product) ?? 0) + 1);
  const labels = { active: "פעיל", paused: "מושהה", churned: "עזב" } as const;
  return <>
    <Metrics metrics={[
      { label: "לקוחות פעילים", value: number(active.length), detail: "לפי נתוני הסוכן", icon: UserRoundCheck },
      { label: "סך הלקוחות", value: number(crm.customers.length), detail: "כולל מושהים ועזבו", icon: UsersRound },
      { label: "עזבו", value: number(crm.customers.filter(row => row.status === "churned").length), detail: "לקוחות שסומנו כעזבו", icon: TriangleAlert, tone: "coral" },
    ]}/>
    <div className="split parallel">
      <Panel title="לקוחות פעילים לפי מוצר"><Distribution rows={[...byProduct].map(([name, total]) => ({ name, total }))} units="number" label="לקוחות"/></Panel>
      <Panel title="הכנסות">
        <Blank>הכנסות וסליקה עדיין כבויות במערכת. כאן יוצגו רק נתונים מאומתים, ללא הערכות.</Blank>
      </Panel>
    </div>
    <Panel title="רשימת לקוחות">
      {crm.customers.length ? <DataTable headings={["שם", "יצירת קשר", "מוצרים", "סטטוס", "לקוח מאז"]}>{crm.customers.slice(0, 200).map(row => <tr key={row.id}>
        <td>{row.name}</td><td><bdi>{row.contact || "—"}</bdi></td><td>{row.products.join(", ") || "—"}</td>
        <td><Chip tone={row.status === "active" ? "good" : row.status === "churned" ? "bad" : "neutral"}>{labels[row.status]}</Chip></td>
        <td>{row.since ? displayDate(row.since) : "—"}</td>
      </tr>)}</DataTable> : <Blank>עוד אין לקוחות. ליד שנסגר הופך ללקוח כאן, ואז אפשר לעקוב אחרי המוצר שלו וההכנסה ממנו.</Blank>}
    </Panel>
  </>;
}

export function MarketingView({ data, month }: { data: { crm?: CrmData }; month: string }) {
  const crm = crmOf(data);
  const inMonth = crm.metrics.filter(row => row.date.startsWith(month));
  const posts = crm.posts.filter(row => row.status === "published" && row.publishedOn?.startsWith(month));
  const views = sum(inMonth.map(row => row.views));
  const reach = sum(inMonth.map(row => row.reach));
  const byPlatform = platforms.map(platform => ({ name: platformLabels[platform], total: sum(inMonth.filter(row => row.platform === platform).map(row => row.views)) })).filter(row => row.total > 0);
  const trend = Array.from({ length: 12 }, (_, index) => {
    const key = monthOffset(month, index - 11);
    const rows = crm.metrics.filter(row => row.date.startsWith(key));
    return { label: monthTitle(key), first: rows.length ? sum(rows.map(row => row.views)) : null, second: rows.length ? sum(rows.map(row => row.reach)) : null };
  });
  const perPost = posts.map(post => {
    const rows = crm.metrics.filter(row => row.postKey === post.key);
    return { post, views: sum(rows.map(row => row.views)), saves: sum(rows.map(row => row.saves)), shares: sum(rows.map(row => row.shares)), clicks: sum(rows.map(row => row.clicks)) };
  }).sort((a, b) => b.views - a.views);
  const lastRun = crm.runs[0];
  return <>
    <Metrics metrics={[
      { label: "פוסטים שפורסמו", value: number(posts.length), detail: monthTitle(month), icon: Megaphone },
      { label: "צפיות", value: number(views), detail: "לפי נתוני הרשתות שנקלטו", icon: Eye },
      { label: "חשיפה", value: number(reach), detail: "חשבונות ייחודיים שנחשפו", icon: Activity },
      { label: "קליקים", value: number(sum(inMonth.map(row => row.clicks))), detail: "קליקים לקישורים", icon: MousePointerClick },
    ]}/>
    <div className="split charts-row">
      <Panel title="צפיות לפי רשת"><Distribution rows={byPlatform} units="number" label="צפיות"/></Panel>
      <Panel title="צפיות וחשיפה" action={<span className="range-label">12 חודשים</span>}><Trend rows={trend} firstLabel="צפיות" secondLabel="חשיפה" units="number"/></Panel>
    </div>
    <Panel title="ביצועי פוסטים">
      {perPost.length ? <DataTable headings={["פרסום", "רשת", "מוצר", "פורמט", "פתיח", "צפיות", "שמירות", "שיתופים", "קליקים"]}>{perPost.map(({ post, ...stats }) => <tr key={post.id}>
        <td>{post.publishedOn ? displayDate(post.publishedOn) : "—"}</td><td>{platformLabels[post.platform]}</td><td>{post.product || "—"}</td><td>{post.format || "—"}</td>
        <td>{post.url ? <a className="text-link" href={post.url} rel="noopener noreferrer" target="_blank">{post.hook || "פתיחת הפוסט"}</a> : post.hook || "—"}</td>
        <td>{number(stats.views)}</td><td>{number(stats.saves)}</td><td>{number(stats.shares)}</td><td>{number(stats.clicks)}</td>
      </tr>)}</DataTable> : <Blank>עוד לא פורסם פוסט החודש. פוסט שאישרת במסך האישורים ופורסם יופיע כאן עם הצפיות וההקשות שלו, בלי מספרים מומצאים.</Blank>}
    </Panel>
    <Panel title="פעילות הסוכן">
      {lastRun ? <p>{lastRun.routine}: {lastRun.summary} <span className="range-label">{displayDate(lastRun.at)}</span></p> : <Blank>סוכן השיווק עוד לא רץ. הריצה הראשונה שלו מתוזמנת לשעה 16:23.</Blank>}
    </Panel>
  </>;
}
