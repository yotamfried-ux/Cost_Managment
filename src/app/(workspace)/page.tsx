import { ChartNoAxesColumnIncreasing } from "lucide-react";
import { requireWorkspace } from "@/lib/session";
import { monthTitle, resolveMonth } from "@/lib/finance";
import { includedStatus, allCharges, lookups, subscriptions, summary, type Search, searchFields } from "@/lib/queries";
import { costBreakdown } from "@/lib/cost-breakdown";
import { Add, displayDate, Flash, href, PageTitle, Panel, SubscriptionRows, TextLink } from "@/components/dashboard";
import { ExpenseCharts, ExpenseMetrics, MonthlySubscriptions, ProjectList, SupplierCosts } from "@/components/views";
import { FormPanel } from "@/components/forms";
import { FinanceReview } from "@/components/finance-review";

export default async function Home({ searchParams }: { searchParams: Promise<Search> }) {
  const [access, raw] = await Promise.all([requireWorkspace(), searchParams]);
  const search = searchFields(raw);
  const month = resolveMonth(search.month);
  const totals = summary(access, month);
  const { projects, suppliers } = lookups(access);
  const activeProjects = projects.filter(item => item.status === "active");
  const costsByProject = new Map(totals.projects.map(item => [item.project_id, item.total]));
  const upcoming = subscriptions(access, true);
  const costs = costBreakdown(allCharges(access, month, { status: includedStatus })).all;
  const rate = access.data.usdReferenceRate;
  const checked = access.data.usdReferenceCheckedAt;
  const checkTime = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" });
  const canEdit = access.role !== "viewer";
  return <>
    <PageTitle title="ניהול העסק" description="הוצאות העסק, עלויות לפי פרויקט ותשלומים לבדיקה." icon={ChartNoAxesColumnIncreasing}>
      {canEdit && <Add path="/" month={month} kind="expense">הוספת הוצאה</Add>}
    </PageTitle>
    <Flash search={search}/>
    {canEdit && <FormPanel path="/" kind={search.add === "expense" ? "expense" : undefined} month={month} projects={projects} suppliers={suppliers}/>}
    <ExpenseMetrics totals={totals} upcoming={upcoming}/>
    <FinanceReview access={access} month={month} totals={totals}/>
    {rate && <p className="notice">שער דולר יציג · <bdi>1 USD = {rate.quote} ILS</bdi> · פורסם {displayDate(rate.quoted)} בבנק ישראל
      {checked ? ` · בדיקה אחרונה שתועדה ${checkTime.format(new Date(checked))}` : " · נבדק אחת לשעה"}</p>}
    <SupplierCosts title="הוצאות החודש לפי ספק" group={costs} path="/expenses" search={{ month }}
      action={<TextLink to={href("/expenses", { month, view: "transactions" })}>לכל התנועות</TextLink>}/>
    <MonthlySubscriptions rows={subscriptions(access)} month={month}/>
    <ExpenseCharts totals={totals} month={month} title={`התפלגות הוצאות (${monthTitle(month)})`} trendTitle="מגמת הוצאות חודשית"/>
    <div className="split parallel">
      <Panel title="חיובים קרובים" action={<TextLink to={href("/suppliers", { month })}>לכל החיובים</TextLink>}>
        <SubscriptionRows rows={upcoming.slice(0, 4)} upcoming/>
      </Panel>
      <Panel title="פרויקטים פעילים" action={<TextLink to={href("/projects", { month })}>לכל הפרויקטים</TextLink>}>
        <ProjectList projects={activeProjects.sort((a, b) => (costsByProject.get(b.id) ?? 0) - (costsByProject.get(a.id) ?? 0)).slice(0, 3)} totals={totals} month={month} compact/>
      </Panel>
    </div>
  </>;
}
