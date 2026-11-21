import { notFound } from "next/navigation";
import { ArrowLeft, Layers3 } from "lucide-react";
import { requireWorkspace } from "@/lib/session";
import { listCharges, lookups, summary, isId, type Search, searchFields } from "@/lib/queries";
import { resolveMonth } from "@/lib/finance";
import { Charges, href, PageTitle, Pagination, Panel, TextLink } from "@/components/dashboard";
import { ExpenseCharts, ExpenseMetrics } from "@/components/views";

export default async function ProjectDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const [access, { id }, raw] = await Promise.all([requireWorkspace(), params, searchParams]);
  if (!isId(id)) notFound();
  const search = searchFields(raw);
  const month = resolveMonth(search.month);
  const { projects } = await lookups(access);
  const project = projects.find(row => row.id === id);
  if (!project) notFound();
  const [totals, expenses] = await Promise.all([summary(access, month, id), listCharges(access, month, { ...search, project: id })]);
  return <>
    <PageTitle title={project.name} description={project.description || "עלויות והוצאות משויכות לפרויקט"} icon={Layers3}>
      <TextLink to={href("/projects", { month })}>לכל הפרויקטים <ArrowLeft size={13} aria-hidden="true"/></TextLink>
    </PageTitle>
    <ExpenseMetrics totals={totals} upcoming={[]}/>
    <ExpenseCharts totals={totals} month={month} title="התפלגות עלויות הפרויקט"/>
    <Panel title="הוצאות משויכות"><Charges rows={expenses.rows} projectShare/>
      <Pagination path={`/projects/${id}`} search={{ ...search, month }} total={expenses.count}/></Panel>
  </>;
}
