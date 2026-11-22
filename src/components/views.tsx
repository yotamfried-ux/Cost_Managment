import Link from "next/link";
import { Fragment } from "react";
import { CalendarDays, CircleCheck, Database, FileText, Folder, Layers3, Sparkles, Target } from "lucide-react";
import { formatMoney, monthOffset, monthTitle } from "@/lib/finance";
import type { CostTotal, costBreakdown } from "@/lib/cost-breakdown";
import { actualStatus, unassigned, type Summary, type Project, type Search, type Subscription } from "@/lib/queries";
import { Blank, categoryNames, Chip, DataTable, formatAmount, href, Metrics, Panel, TextLink } from "./dashboard";
import { Distribution, Trend } from "./charts";

export function ExpenseMetrics({ totals, upcoming, home = false }: { totals: Summary; upcoming: Subscription[]; home?: boolean }) {
  const get = (key: string) => totals.evidence.find(row => row.name === key);
  const verified = get("verified");
  const provider = get("provider");
  const estimate = get("estimate");
  const combined = (verified?.total != null || provider?.total != null) ? (verified?.total ?? 0) + (provider?.total ?? 0) : null;
  const inIls = upcoming.filter(row => row.currency === "ILS" && row.amount_minor !== null);
  const upcomingAmount = inIls.length ? inIls.reduce((sum, row) => sum + (row.amount_minor ?? 0), 0) : null;
  return <Metrics metrics={[
    { label: home ? "תזרים חודשי (נטו)" : "סך הוצאות החודש", value: formatAmount(home ? null : combined), detail: home ? "נתוני הכנסות חסרים" : "מאומת ונתוני ספק · סכומים בש״ח", icon: Database, tone: "coral" },
    { label: "הוצאות מאומתות", value: formatAmount(verified?.total), detail: verified ? `${verified.entries} חיובים עם מסמך מקור` : "טרם אומתו חיובים", icon: CircleCheck },
    { label: "עלויות משוערות", value: formatAmount(estimate?.total), detail: estimate ? `${estimate.entries} רשומות אומדן` : "אין אומדנים בש״ח", icon: Sparkles },
    { label: "חיובים קרובים", value: formatAmount(upcomingAmount), detail: `${upcoming.length} התחייבויות ב־14 הימים הקרובים`, icon: CalendarDays, tone: "neutral" },
  ]}/>;
}
export function ExpenseCharts({ totals, month, title = "התפלגות הוצאות", trendTitle = "מגמת הוצאות" }: {
  totals: Summary; month: string; title?: string; trendTitle?: string;
}) {
  const trends = Array.from({ length: 12 }, (_, index) => monthOffset(month, index - 11)).map(key => {
    const event = totals.trend.find(row => row.month === key);
    return { label: monthTitle(key), first: event?.verified ?? null, second: event?.provider ?? null };
  });
  const omitted = totals.evidence.reduce((total, row) => total + row.fx_missing, 0);
  return <>
    {omitted > 0 && <p className="notice" role="status">{omitted} הוצאות במטבע זר ללא שער המרה. סכומיהן המקוריים זמינים ברשימת ההוצאות.</p>}
    <div className="split charts-row"><Panel title={title}>
      <Distribution rows={totals.categories} label="הוצאות חיוביות בש״ח"/>
    </Panel><Panel title={trendTitle} action={<span className="range-label">12 חודשים</span>}>
      <Trend rows={trends} firstLabel="הוצאות מאומתות" secondLabel="נתוני ספק"/>
    </Panel></div>
  </>;
}
const projectStates: Record<string,string> = { active: "פעיל", planned: "בתכנון", archived: "בארכיון" };
export function ProjectList({ projects, totals, month, compact = false }: { projects: Project[]; totals: Summary; month: string; compact?: boolean }) {
  if (!projects.length) return <Blank>טרם נוספו פרויקטים.</Blank>;
  return <div className={compact ? "project-list" : "project-grid"}>{projects.map(project => {
    const cost = totals.projects.find(item => item.project_id === project.id)?.total;
    const percent = cost != null && project.monthly_budget_minor ? Math.max(0, Math.round(cost / project.monthly_budget_minor * 100)) : null;
    return <Link key={project.id} className={compact ? "project-row" : "panel project-card"} href={href(`/projects/${project.id}`, { month })}>
      <span className="project-icon"><Layers3 size={20} aria-hidden="true"/></span><div className="project-label"><strong>{project.name}</strong>{project.description && <small>{project.description}</small>}</div>
      <strong className="project-cost"><bdi>{formatAmount(cost)}</bdi></strong>
      {!compact && <>
        <Chip tone={project.status === "active" ? "good" : "pending"}>{projectStates[project.status]}</Chip>
        <div className="budget">
          <span>תקציב חודשי · <bdi>{formatAmount(project.monthly_budget_minor)}</bdi></span>
          {percent !== null && <><strong>{percent}%</strong><progress max={100} value={Math.min(100, percent)} aria-label="ניצול תקציב"/></>}
        </div>
      </>}
    </Link>;
  })}</div>;
}
export function ProjectMetrics({ projects, totals }: { projects: Project[]; totals: Summary }) {
  const budget = projects.filter(row => row.monthly_budget_minor);
  const cost = totals.projects.length ? totals.projects.reduce((acc, row) => acc + row.total, 0) : null;
  const totalBudget = budget.reduce((sum, row) => sum + (row.monthly_budget_minor ?? 0), 0);
  const budgetedIds = new Set(budget.map(row => row.id));
  const tracked = totals.projects.filter(row => budgetedIds.has(row.project_id));
  const used = tracked.length ? tracked.reduce((sum, row) => sum + row.total, 0) : null;
  return <Metrics metrics={[
    { label: "פרויקטים פעילים", value: projects.filter(row => row.status === "active").length, detail: `מתוך ${projects.length} פרויקטים`, icon: Folder },
    { label: "עלות פרויקטים חודשית", value: formatAmount(cost), detail: "מאומת ונתוני ספק · סכומים בש״ח", icon: Database, tone: "coral" },
    { label: "ניצול תקציב", value: totalBudget && used !== null ? `${Math.round(used / totalBudget * 100)}%` : "—", detail: `${budget.length} פרויקטים עם תקציב`, icon: Target },
    { label: "עלויות ללא שיוך", value: formatAmount(totals.unallocated), detail: "מאומת ונתוני ספק · סכומים בש״ח", icon: FileText },
  ]}/>;
}
export function ProjectDistribution({ totals, projects }: { totals: Summary; projects: Project[] }) {
  const rows = totals.projects.filter(row => row.total > 0).map(row => ({ name: projects.find(item => item.id === row.project_id)?.name ?? "פרויקט", total: row.total }));
  if ((totals.unallocated ?? 0) > 0) rows.push({ name: "ללא שיוך", total: totals.unallocated! });
  return <Distribution rows={rows} label="הוצאות חיוביות בש״ח"/>;
}

type CostBreakdown = ReturnType<typeof costBreakdown>;

function CostCells({ total }: { total: CostTotal }) {
  return <>
    <td>
      {total.currencies.size ? [...total.currencies].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amount]) =>
        <div key={currency}><MoneyInCurrency amount={amount} currency={currency}/></div>
      ) : "—"}
      {total.missingAmount && <small>חסרים סכומים</small>}
    </td>
    <td><bdi>{formatAmount(total.ils)}</bdi>{total.missingFx && <div><small>{total.ils === null ? "חסר שער המרה" : "סכום חלקי · חסר שער המרה"}</small></div>}</td>
  </>;
}

export function SupplierCosts({ title, group, path, search, action }: {
  title: string; group?: CostBreakdown["all"]; path: string; search: Search; action?: React.ReactNode;
}) {
  return <Panel title={title} action={action}>
    {group?.suppliers.size ? <DataTable headings={["ספק תשתית", "סך במטבע המקורי", "סך בש״ח", "פירוט"]}>
      {[...group.suppliers.values()].sort((a,b) => a.name.localeCompare(b.name,"he")).map(({ id, name, total }) => <tr key={id}>
        <th scope="row">{name}</th><CostCells total={total}/>
        <td><TextLink to={href(path, search, { supplier: id, view: "transactions", page: undefined, status: search.status || actualStatus })}>פירוט חיובים</TextLink></td>
      </tr>)}
      <tr><th scope="row">סך החיובים</th><CostCells total={group.total}/><td /></tr>
    </DataTable> : <Blank>אין חיובים לסיכום בתקופה ובמסננים שנבחרו.</Blank>}
  </Panel>;
}

export function ProjectCosts({ groups, projects, month }: {
  groups: CostBreakdown["projects"]; projects: Project[]; month: string;
}) {
  const visible = [
    ...projects.map(({ id, name }) => ({ id, name, path: `/projects/${id}` })),
    { id: unassigned, name: "ללא שיוך לפרויקט", path: "/expenses" },
  ];
  return <Panel title="עלות חודשית לפי פרויקט ותשתית">
    {groups.size ? <DataTable headings={["פרויקט ותשתית", "סך במטבע המקורי", "סך בש״ח", "פירוט"]}>
      {visible.map(({ id, name, path }) => {
        const group = groups.get(id);
        const search = { month, project: id === unassigned ? id : undefined };
        return <Fragment key={id}>
          <tr className="cost-project"><th scope="row">{name}</th>
            {group ? <CostCells total={group.total}/> : <td colSpan={2}>אין חיובים משויכים</td>}
            <td>{(group || id !== unassigned) && <TextLink to={href(path, search)}>סיכום {id === unassigned ? "ללא שיוך" : "פרויקט"}</TextLink>}</td>
          </tr>
          {group && [...group.suppliers.values()].sort((a,b) => a.name.localeCompare(b.name,"he")).map(supplier => <tr key={supplier.id}>
            <th scope="row" className="cost-supplier">{supplier.name}</th><CostCells total={supplier.total}/>
            <td><TextLink to={href(path, search, { supplier: supplier.id, status: actualStatus, view: "transactions" })}>פירוט חיובים</TextLink></td>
          </tr>)}
        </Fragment>;
      })}
    </DataTable> : <Blank>אין חיובים בתקופה שנבחרה.</Blank>}
  </Panel>;
}

export function Filters({ path, search, projects = [], suppliers, invoice = false }: {
  path: string; search: Search; projects?: Project[]; suppliers: { id: string; name: string }[]; invoice?: boolean;
}) {
  return <form action={path} className="panel filters">
    <input type="hidden" name="month" value={search.month}/>
    {search.view === "transactions" && <input type="hidden" name="view" value="transactions"/>}
    <label className="filter-search"><span className="visually-hidden">חיפוש</span><input type="search" name="q" defaultValue={search.q} placeholder={invoice ? "חיפוש במסמכים..." : "חיפוש בהוצאות..."}/></label>
    {!invoice && <label><span className="visually-hidden">פרויקט</span><select name="project" defaultValue={search.project ?? ""}><option value="">כל הפרויקטים</option><option value={unassigned}>ללא שיוך לפרויקט</option>{projects.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>}
    {!invoice && <label><span className="visually-hidden">קטגוריה</span><select name="category" defaultValue={search.category ?? ""}><option value="">כל הקטגוריות</option>{categoryNames.map(name => <option key={name}>{name}</option>)}</select></label>}
    <label><span className="visually-hidden">סטטוס</span><select name="status" defaultValue={search.status ?? ""}><option value="">{!invoice && search.view !== "transactions" ? "מאומת ונתוני ספק" : "כל הסטטוסים"}</option>
      {invoice ? <><option value="matched">מותאם</option><option value="review">לבדיקה</option></> :
        <>{search.view === "transactions" && <option value={actualStatus}>מאומת ונתוני ספק</option>}<option value="verified">מאומת</option><option value="provider">נתוני ספק</option><option value="estimate">אומדן</option><option value="missing">חסר מקור</option></>}</select></label>
    <label><span className="visually-hidden">ספק</span><select name="supplier" defaultValue={search.supplier ?? ""}><option value="">כל הספקים</option>{!invoice && <option value={unassigned}>ללא ספק</option>}{suppliers.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
    <label><span className="visually-hidden">סדר תאריך</span><select name="sort" defaultValue={search.sort ?? ""}><option value="">מהחדש לישן</option><option value="oldest">מהישן לחדש</option></select></label>
    <button className="button">סינון</button><Link href={href(path, { month: search.month, view: search.view })} className="button">ניקוי</Link>
  </form>;
}

export function MoneyInCurrency({ amount, currency }: { amount: number; currency: string }) {
  return <bdi>{formatMoney(amount, currency)}</bdi>;
}
