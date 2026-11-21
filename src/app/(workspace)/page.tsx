import { ChartNoAxesColumnIncreasing } from "lucide-react";
import { requireWorkspace } from "@/lib/session";
import { monthTitle, resolveMonth } from "@/lib/finance";
import { listCharges, lookups, subscriptions, summary, type Search } from "@/lib/queries";
import { Add, Charges, Flash, href, PageTitle, Panel, SubscriptionRows, TextLink } from "@/components/dashboard";
import { ExpenseCharts, ExpenseMetrics, ProjectList } from "@/components/views";
import { FormPanel } from "@/components/forms";

export default async function Home({ searchParams }: { searchParams: Promise<Search> }) {
  const [access, search] = await Promise.all([requireWorkspace(), searchParams]);
  const month = resolveMonth(search.month);
  const [totals, { projects, suppliers }, upcoming, recent] = await Promise.all([
    summary(access, month), lookups(access), subscriptions(access, true), listCharges(access, month, {}),
  ]);
  const canEdit = access.role !== "viewer";
  return <>
    <PageTitle title="ניהול העסק" description="סקירה של ההוצאות, הפרויקטים והתזרים של העסק." icon={ChartNoAxesColumnIncreasing}>
      {canEdit && <Add path="/" month={month} kind="expense">הוספת הוצאה</Add>}
    </PageTitle>
    <Flash search={search}/>
    {canEdit && <FormPanel path="/" kind={search.add === "expense" ? "expense" : undefined} month={month} projects={projects} suppliers={suppliers}/>}
    <ExpenseMetrics totals={totals} upcoming={upcoming} home/>
    <ExpenseCharts totals={totals} month={month} title={`התפלגות הוצאות (${monthTitle(month)})`} trendTitle="מגמת הוצאות ותזרים"/>
    <div className="split parallel">
      <Panel title="חיובים קרובים" action={<TextLink to={href("/suppliers", { month })}>לכל החיובים</TextLink>}>
        <SubscriptionRows rows={upcoming.slice(0, 4)} upcoming/>
      </Panel>
      <Panel title="פרויקטים פעילים" action={<TextLink to={href("/projects", { month })}>לכל הפרויקטים</TextLink>}>
        <ProjectList projects={projects.filter(item => item.status === "active").slice(0, 3)} totals={totals} month={month} compact/>
      </Panel>
    </div>
    <Panel title="פעילות אחרונה" action={<TextLink to={href("/expenses", { month })}>לכל התנועות</TextLink>}>
      <Charges rows={recent.rows.slice(0, 5)} compact/>
    </Panel>
  </>;
}
