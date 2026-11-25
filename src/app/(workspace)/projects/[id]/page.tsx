import { notFound } from "next/navigation";
import { ArrowLeft, Layers3 } from "lucide-react";
import { requireWorkspace } from "@/lib/session";
import { includedStatus, allCharges, listCharges, lookups, summary, isId, type Search, searchFields } from "@/lib/queries";
import { costBreakdown } from "@/lib/cost-breakdown";
import { resolveMonth } from "@/lib/finance";
import { Charges, href, PageTitle, Pagination, Panel, TextLink } from "@/components/dashboard";
import { ExpenseCharts, ExpenseMetrics, SupplierCosts } from "@/components/views";

export default async function ProjectDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const [access, { id }, raw] = await Promise.all([requireWorkspace(), params, searchParams]);
  if (!isId(id)) notFound();
  const search = searchFields(raw);
  const month = resolveMonth(search.month);
  const { projects } = await lookups(access);
  const project = projects.find(row => row.id === id);
  if (!project) notFound();
  const path = `/projects/${id}`;
  const detailed = search.view === "transactions";
  const totals = summary(access, month, id);
  const expenses = detailed ? listCharges(access, month, { ...search, project: id }) : null;
  const costs = detailed ? undefined : costBreakdown(allCharges(access, month, { project: id, status: includedStatus })).projects.get(id);
  return <>
    <PageTitle title={project.name} description={project.description || "עלויות והוצאות משויכות לפרויקט"} icon={Layers3}>
      <TextLink to={href("/projects", { month })}>לכל הפרויקטים <ArrowLeft size={13} aria-hidden="true"/></TextLink>
      <TextLink to={href(path, { month }, { view: detailed ? undefined : "transactions" })}>{detailed ? "סיכום לפי תשתית" : "כל התנועות בפרויקט"}</TextLink>
    </PageTitle>
    <ExpenseMetrics totals={totals} upcoming={[]}/>
    {expenses ? <Panel title="הוצאות משויכות"><Charges rows={expenses.rows} projectShare/>
      <Pagination path={path} search={{ ...search, month }} total={expenses.count}/></Panel>
      : <SupplierCosts title="עלות הפרויקט לפי ספק תשתית" group={costs} path={path} search={{ month }}/>}
    <ExpenseCharts totals={totals} month={month} project={id} title="התפלגות עלויות הפרויקט"/>
  </>;
}
