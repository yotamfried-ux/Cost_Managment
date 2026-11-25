import { ChartNoAxesColumnIncreasing } from "lucide-react";
import { requireWorkspace } from "@/lib/session";
import { monthTitle, resolveMonth } from "@/lib/finance";
import { actualStatus, allCharges, lookups, subscriptions, summary, type Search, searchFields } from "@/lib/queries";
import { costBreakdown } from "@/lib/cost-breakdown";
import { monthlyForecast } from "@/lib/monthly-forecast";
import { Add, displayDate, Flash, href, PageTitle, Panel, SubscriptionRows, TextLink } from "@/components/dashboard";
import { ExpenseCharts, ExpenseMetrics, MonthlySubscriptions, ProjectList, SupplierCosts } from "@/components/views";
import { FormPanel } from "@/components/forms";

export default async function Home({ searchParams }: { searchParams: Promise<Search> }) {
  const [access, raw] = await Promise.all([requireWorkspace(), searchParams]);
  const search = searchFields(raw);
  const month = resolveMonth(search.month);
  const totals = summary(access, month);
  const { projects, suppliers } = lookups(access);
  const upcoming = subscriptions(access, true);
  const costs = costBreakdown(allCharges(access, month, { status: actualStatus })).all;
  const rate = access.data.usdReferenceRate;
  const canEdit = access.role !== "viewer";
  return <>
    <PageTitle title="ניהול העסק" description="סקירה של ההוצאות, הפרויקטים והתזרים של העסק." icon={ChartNoAxesColumnIncreasing}>
      {canEdit && <Add path="/" month={month} kind="expense">הוספת הוצאה</Add>}
    </PageTitle>
    <Flash search={search}/>
    {canEdit && <FormPanel path="/" kind={search.add === "expense" ? "expense" : undefined} month={month} projects={projects} suppliers={suppliers}/>}
    <ExpenseMetrics totals={totals} upcoming={upcoming} home forecast={monthlyForecast(access.data, month)}/>
    {rate && <p className="notice">שער דולר יציג · <bdi>1 USD = {rate.quote} ILS</bdi> · {displayDate(rate.quoted)} · בנק ישראל</p>}
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
