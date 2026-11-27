import { ChartNoAxesColumnIncreasing } from "lucide-react";
import { requireWorkspace } from "@/lib/session";
import { monthTitle, resolveMonth } from "@/lib/finance";
import { includedStatus, allCharges, lookups, subscriptions, summary, type Search, searchFields } from "@/lib/queries";
import { costBreakdown } from "@/lib/cost-breakdown";
import { Add, Blank, displayDate, formatAmount, Flash, href, PageTitle, Panel, SubscriptionRows, TextLink } from "@/components/dashboard";
import { ExpenseCharts, ExpenseMetrics, MonthlySubscriptions, ProjectList, SupplierCosts } from "@/components/views";
import { FormPanel } from "@/components/forms";
import Link from "next/link";
import { normalizeCrm } from "@/lib/business";
import { attentionText, ownerAttention } from "@/lib/owner-attention";
import { currentTime } from "@/lib/publishing";

export default async function Home({ searchParams }: { searchParams: Promise<Search> }) {
  const [access, raw] = await Promise.all([requireWorkspace(), searchParams]);
  const search = searchFields(raw);
  const month = resolveMonth(search.month);
  const totals = summary(access, month);
  const { projects, suppliers } = lookups(access);
  const upcoming = subscriptions(access, true);
  const costs = costBreakdown(allCharges(access, month, { status: includedStatus })).all;
  const rate = access.data.usdReferenceRate;
  const checked = access.data.usdReferenceCheckedAt;
  const checkTime = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" });
  const canEdit = access.role !== "viewer";
  const attention = ownerAttention({ crm: normalizeCrm(structuredClone(access.data.crm)), unallocatedMinor: totals.unallocated, upcomingCharges: upcoming.length, nowMs: currentTime() });
  return <>
    <PageTitle title="ניהול העסק" description="סקירה של ההוצאות, הפרויקטים והתזרים של העסק." icon={ChartNoAxesColumnIncreasing}>
      {canEdit && <Add path="/" month={month} kind="expense">הוספת הוצאה</Add>}
    </PageTitle>
    <Flash search={search}/>
    {canEdit && <FormPanel path="/" kind={search.add === "expense" ? "expense" : undefined} month={month} projects={projects} suppliers={suppliers}/>}
    <Panel title="מה דורש אותך עכשיו">
      {attention.length ? <ul className="attention">{attention.map(item => <li key={item.id}><Link href={`${item.href}${item.href.includes("?") ? "&" : "?"}month=${month}`}><span className={`dot ${item.tone}`} aria-hidden="true"/>{attentionText(item, formatAmount(totals.unallocated))}</Link></li>)}</ul>
        : <Blank>אין כרגע משהו שמחכה לך. כשסוכן יכין פוסט לאישור או ישאל שאלה, זה יופיע כאן.</Blank>}
    </Panel>
    <ExpenseMetrics totals={totals} upcoming={upcoming}/>
    {rate && <p className="notice">שער דולר יציג · <bdi>1 USD = {rate.quote} ILS</bdi> · פורסם {displayDate(rate.quoted)} בבנק ישראל
      {checked ? ` · בדיקה אחרונה שתועדה ${checkTime.format(new Date(checked))}` : " · נבדק אחת לשעה"}</p>}
    <SupplierCosts title="הוצאות החודש לפי ספק" group={costs} path="/expenses" search={{ month }}
      action={<TextLink to={href("/expenses", { month, view: "transactions" })}>לכל התנועות</TextLink>}/>
    <MonthlySubscriptions rows={subscriptions(access)} month={month}/>
    <ExpenseCharts totals={totals} month={month} title={`התפלגות הוצאות (${monthTitle(month)})`} trendTitle="מגמת הוצאות ותזרים"/>
    <div className="split parallel">
      <Panel title="חיובים קרובים" action={<TextLink to={href("/suppliers", { month })}>לכל החיובים</TextLink>}>
        <SubscriptionRows rows={upcoming.slice(0, 4)} upcoming/>
      </Panel>
      <Panel title="פרויקטים פעילים" action={<TextLink to={href("/projects", { month })}>לכל הפרויקטים</TextLink>}>
        <ProjectList projects={projects.filter(item => item.status === "active").slice(0, 3)} totals={totals} month={month} compact/>
      </Panel>
    </div>
  </>;
}
