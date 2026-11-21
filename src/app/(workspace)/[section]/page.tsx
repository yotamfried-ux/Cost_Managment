import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, Building2, CalendarDays, ChartNoAxesColumnIncreasing, CircleCheck, CreditCard, Database, Download, FileText, Layers3, Plug, Settings as SettingsIcon, ShieldCheck, TriangleAlert, UsersRound, X } from "lucide-react";
import { requireWorkspace } from "@/lib/session";
import { businessDate, evidenceLabels, monthOffset, monthTitle, resolveMonth } from "@/lib/finance";
import { allCharges, invoices, listCharges, lookups, subscriptions, summary, type Access, type Search, searchFields } from "@/lib/queries";
import { adapterProviders, providerCatalog } from "@/lib/connectors";
import { mutate } from "@/app/finance-actions";
import { Add, Blank, Charges, Chip, DataTable, displayDate, Export, Flash, formatAmount, href, InvoiceRows, Metrics, PageTitle, Pagination, Panel, SubscriptionRows, TextLink } from "@/components/dashboard";
import { Distribution, Trend } from "@/components/charts";
import { ExpenseCharts, ExpenseMetrics, Filters, MoneyInCurrency, ProjectDistribution, ProjectList, ProjectMetrics } from "@/components/views";
import { FormFields, FormPanel } from "@/components/forms";

type View = { access: Access; search: Search; month: string; edit: boolean };

const pages: Record<string, (view: View) => Promise<React.ReactNode>> = {
  expenses: Expenses, projects: Projects, invoices: Invoices, suppliers: Suppliers,
  reports: Reports, integrations: Integrations, settings: Settings,
};

export default async function Section({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<Search> }) {
  const { section } = await params;
  if (!Object.hasOwn(pages, section)) notFound();
  const [access, raw] = await Promise.all([requireWorkspace(), searchParams]);
  const input = searchFields(raw);
  const month = resolveMonth(input.month);
  return pages[section]({ access, month, search: { ...input, month }, edit: access.role !== "viewer" });
}

async function Expenses({ access, month, search, edit }: View) {
  const [totals, upcoming, directory, result] = await Promise.all([
    summary(access, month), subscriptions(access, true), lookups(access), listCharges(access, month, search),
  ]);
  const fxCandidates = result.rows.filter(row => row.currency !== "ILS" && row.amount_minor !== null);
  return <>
    <PageTitle title="הוצאות" description="מעקב אחר הוצאות העסק לפי פרויקטים, קטגוריות וספקים." icon={Database}>
      <Export search={search}/>
      {edit && fxCandidates.length > 0 && <Link className="button" href={href("/expenses", search, { add: "fx" })}>עדכון שער המרה</Link>}
      {edit && <Add path="/expenses" month={month} kind="expense">הוצאה חדשה</Add>}
    </PageTitle>
    <Flash search={search}/>
    {edit && <FormPanel {...directory} path="/expenses" kind={["expense", "fx"].includes(search.add ?? "") ? search.add : undefined} month={month} candidates={fxCandidates}/>}
    <ExpenseMetrics totals={totals} upcoming={upcoming}/>
    <ExpenseCharts totals={totals} month={month} title="פילוח הוצאות לפי קטגוריה" trendTitle="מגמת הוצאות חודשית"/>
    <Filters {...directory} path="/expenses" search={search}/>
    <Panel title={`רשימת הוצאות (${result.count})`}>
      <Charges rows={result.rows}/><Pagination path="/expenses" search={search} total={result.count}/>
    </Panel>
  </>;
}

async function Projects({ access, month, search, edit }: View) {
  const [totals, directory] = await Promise.all([summary(access, month), lookups(access)]);
  return <>
    <PageTitle title="פרויקטים" description="עלויות, תקציבים והוצאות משויכות לפרויקטים של העסק." icon={Layers3}>
      {edit && <Add path="/projects" month={month} kind="project">פרויקט חדש</Add>}
    </PageTitle>
    <Flash search={search}/>
    {edit && <FormPanel {...directory} path="/projects" kind={search.add === "project" ? "project" : undefined} month={month}/>}
    <ProjectMetrics projects={directory.projects} totals={totals}/>
    <ProjectList projects={directory.projects} totals={totals} month={month}/>
    <div className="split parallel"><Panel title="חלוקת עלויות לפי פרויקט"><ProjectDistribution totals={totals} projects={directory.projects}/></Panel>
      <Panel title="פרויקטים פעילים"><ProjectList projects={directory.projects.filter(row => row.status === "active")} totals={totals} month={month} compact/></Panel>
    </div>
  </>;
}

async function Invoices({ access, month, search, edit }: View) {
  const [directory, result] = await Promise.all([lookups(access), invoices(access, month, search)]);
  const current = result.history.filter(row => row.issued_on.startsWith(month));
  const matched = current.filter(row => row.status === "matched").length;
  const bySupplier = new Map<string, number>();
  for (const row of current) {
    const name = row.suppliers?.name ?? "ללא ספק";
    bySupplier.set(name, (bySupplier.get(name) ?? 0) + 1);
  }
  const history = Array.from({ length: 12 }, (_, index) => {
    const key = monthOffset(month, index - 11);
    const rows = result.history.filter(row => row.issued_on.startsWith(key));
    return { label: monthTitle(key), first: rows.filter(row => row.status === "matched").length || null, second: rows.filter(row => row.status === "review").length || null };
  });
  const item = result.selected;
  const candidates = item && edit && item.status !== "matched"
    ? allCharges(access, item.issued_on.slice(0, 7), { supplier: item.supplier_id }) : [];
  const matches = candidates.filter(row => row.amount_minor === item?.amount_minor && row.currency === item?.currency && !row.reconciliation_matches);
  return <>
    <PageTitle title="חשבוניות" description="ניהול חשבוניות, קבלות ומסמכי מקור של העסק." icon={FileText}>
      {edit && <Add path="/invoices" month={month} kind="invoice">העלאת חשבונית</Add>}
    </PageTitle>
    <Flash search={search}/>
    {edit && <FormPanel {...directory} path="/invoices" kind={search.add === "invoice" ? "invoice" : undefined} month={month}/>}
    <Metrics metrics={[
      { label: "מסמכים שהתקבלו", value: current.length, detail: monthTitle(month), icon: FileText, tone: "coral" },
      { label: "חשבוניות מותאמות", value: matched, detail: "מסמכים שמקושרים להוצאה", icon: CircleCheck },
      { label: "ממתינות להתאמה", value: current.length - matched, detail: "חשבוניות שטרם שויכו להוצאה", icon: Activity },
      { label: "מסמכים חסרים", value: "—", detail: "בהתאם למקורות החיוב המחוברים", icon: TriangleAlert, tone: "coral" },
    ]}/>
    <div className="split charts-row">
      <Panel title="חשבוניות לפי מקור"><Distribution rows={[...bySupplier].map(([name,total]) => ({ name,total }))} units="number" label="סה״כ מסמכים"/></Panel>
      <Panel title="מספר חשבוניות לפי סטטוס" action={<span className="range-label">12 חודשים</span>}>
        <Trend rows={history} firstLabel="מותאמות" secondLabel="ממתינות" units="number"/>
      </Panel>
    </div>
    <Filters path="/invoices" search={search} suppliers={directory.suppliers} invoice/>
    <div className={item ? "with-drawer" : undefined}>
      <Panel title={`מסמכי חשבוניות (${result.count})`}>
        <InvoiceRows rows={result.rows} search={search}/><Pagination path="/invoices" search={search} total={result.count}/>
      </Panel>
      {item && <Panel title="פרטי חשבונית" action={<Link className="icon-button" href={href("/invoices", search, { invoice: undefined })} aria-label="סגירת פרטי חשבונית"><X size={17}/></Link>}>
        <dl className="info-list"><div><dt>מספר</dt><dd><bdi>{item.invoice_number}</bdi></dd></div><div><dt>ספק</dt><dd>{item.suppliers?.name}</dd></div>
          <div><dt>תאריך</dt><dd>{displayDate(item.issued_on)}</dd></div><div><dt>סכום</dt><dd><MoneyInCurrency amount={item.amount_minor} currency={item.currency}/></dd></div></dl>
        <a className="button" href={`/api/documents/${item.id}`}><Download size={16} aria-hidden="true"/>הורדת PDF מקורי</a>
        {edit && item.status !== "matched" && (matches.length > 0 ? <form className="field-stack reconcile" action={mutate.bind(null, "match")}>
          <FormFields path="/invoices" month={month}/><input type="hidden" name="invoice" value={item.id}/>
          <label>התאמה להוצאה<select name="charge" required>{matches.map(row => <option value={row.id} key={row.id}>{row.description} · {displayDate(row.recorded_on)}</option>)}</select></label>
          <button className="button primary">אישור התאמה</button>
        </form> : <Blank>לא נמצאה הוצאה מתאימה בחודש החשבונית.</Blank>)}
      </Panel>}
    </div>
  </>;
}

async function Suppliers({ access, month, search, edit }: View) {
  const [directory, totals, next, all] = await Promise.all([
    lookups(access), summary(access, month), subscriptions(access, true), subscriptions(access),
  ]);
  const filtered = directory.suppliers.filter(row => !search.q || row.name.toLowerCase().includes(search.q.trim().toLowerCase()));
  const supplierTotal = totals.suppliers.length ? totals.suppliers.reduce((sum, row) => sum + row.total, 0) : null;
  return <>
    <PageTitle title="ספקים" description="ספקי השירות, מנויים והתחייבויות עתידיות של העסק." icon={UsersRound}>
      {edit && <><Add path="/suppliers" month={month} kind="subscription">מנוי חדש</Add><Add path="/suppliers" month={month} kind="supplier">ספק חדש</Add></>}
    </PageTitle>
    <Flash search={search}/>
    {edit && <FormPanel {...directory} path="/suppliers" kind={["subscription","supplier"].includes(search.add ?? "") ? search.add : undefined} month={month}/>}
    <Metrics metrics={[
      { label: "ספקים רשומים", value: directory.suppliers.length, detail: "קטלוג ספקים", icon: UsersRound },
      { label: "הוצאות ספקים", value: formatAmount(supplierTotal), detail: "הוצאות חיוביות בש״ח · מאומת ונתוני ספק", icon: Database },
      { label: "חידושים קרובים", value: next.length, detail: "ב־14 הימים הקרובים", icon: CalendarDays, tone: "coral" },
      { label: "מנויים פעילים", value: all.filter(row => row.status === "active").length, detail: "לפי נתוני המנויים בסביבת העבודה", icon: CreditCard },
    ]}/>
    <div className="split wide-first"><Panel title="פילוח הוצאות לפי ספק"><Distribution rows={totals.suppliers} label="הוצאות חיוביות בש״ח"/></Panel>
      <Panel title="חידושים קרובים"><SubscriptionRows rows={next.slice(0,4)} upcoming/></Panel></div>
    <Panel title="רשימת ספקים" action={<form className="small-filter" action="/suppliers"><input type="hidden" name="month" value={month}/>
      <input name="q" type="search" aria-label="חיפוש ספק" placeholder="חיפוש ספק..." defaultValue={search.q}/><button className="button">חיפוש</button></form>}>
      {filtered.length ? <DataTable headings={["ספק","קטגוריה","הוצאות בתקופה"]}>{filtered.map(row => <tr key={row.id}>
        <td>{row.name}</td><td><Chip>{row.category}</Chip></td><td><TextLink to={href("/expenses",{month,supplier:row.id})}>הצגת הוצאות</TextLink></td>
      </tr>)}</DataTable> : <Blank>אין ספקים להצגה.</Blank>}
    </Panel>
    <Panel title="מנויים וחידושים"><SubscriptionRows rows={all}/></Panel>
  </>;
}

async function Reports({ access, month, search }: View) {
  const annual = search.period === "annual";
  const reportMonth = annual ? month.slice(0,4) + "-01" : month;
  const [totals, directory] = await Promise.all([summary(access, reportMonth, undefined, annual ? 12 : 1), lookups(access)]);
  const actual = totals.evidence.find(row => row.name === "verified");
  const costs = totals.evidence.find(row => row.name === "provider");
  const outlook = totals.evidence.find(row => row.name === "estimate");
  return <>
    <PageTitle title="דוחות" description="מגמות, פילוח וייצוא נתוני הוצאות לתקופה." icon={ChartNoAxesColumnIncreasing}>
      <Link className="button" href={href("/reports",{ month },{ period: annual ? undefined : "annual" })}>{annual ? "עבור לדוח חודשי" : "עבור לסיכום שנתי"}</Link>
      <Export search={search}/>
    </PageTitle>
    <Metrics metrics={[
      { label: "הוצאות מאומתות", value: formatAmount(actual?.total), detail: `${actual?.entries ?? 0} תנועות · ש״ח`, icon: CircleCheck },
      { label: "נתוני ספק", value: formatAmount(costs?.total), detail: `${costs?.entries ?? 0} תנועות · ש״ח`, icon: Database, tone: "coral" },
      { label: "אומדנים בתקופה", value: formatAmount(outlook?.total), detail: `${outlook?.entries ?? 0} תנועות · ש״ח`, icon: Activity },
      { label: "רווח נקי", value: "—", detail: "נתוני הכנסות חסרים", icon: ChartNoAxesColumnIncreasing },
    ]}/>
    <ExpenseCharts totals={totals} month={annual ? monthOffset(reportMonth,11) : month}
      title={annual ? `התפלגות הוצאות לשנת ${reportMonth.slice(0,4)}` : "התפלגות הוצאות החודש"}/>
    <div className="split parallel"><Panel title="הוצאות לפי פרויקט"><ProjectDistribution totals={totals} projects={directory.projects}/></Panel>
      <Panel title="ייצוא דוחות"><div className="report-links">
        <Export search={{ month }}/><a className="button" href={href("/api/export",{ month,period:"annual" })}><Download size={16} aria-hidden="true"/>סיכום שנתי CSV</a>
      </div><p>הייצוא כולל מטבע מקורי, סכום בש״ח אם קיים, ומעמד מקור לכל תנועה.</p></Panel></div>
    <Panel title="תמונת הנתונים לפי מקור">
      {totals.evidence.length ? <DataTable headings={["מקור","רשומות","סכום בש״ח","חסרי שער"]}>{totals.evidence.map(row => <tr key={row.name}>
        <td>{evidenceLabels[row.name]}</td><td>{row.entries}</td><td><bdi>{formatAmount(row.total)}</bdi></td><td>{row.fx_missing}</td>
      </tr>)}</DataTable> : <Blank/>}
    </Panel>
  </>;
}

async function Integrations({ access, month, search }: View) {
  const { accounts } = access.data;
  const runs = access.data.runs.slice(0,30);
  const directory = lookups(access);
  const owner = access.role === "owner";
  const statusText: Record<string, string> = { completed: "הושלם", failed: "נכשל", running: "בתהליך" };
  const reasonText: Record<string, string> = { permission: "חסרה הרשאת קריאה", vendor_request: "בקשת ספק נכשלה", storage: "שמירה נכשלה", vendor_data: "נתוני ספק לא תקינים", provider_response: "תגובה בלתי צפויה מהספק" };
  const active = new Set(accounts.filter(row => runs.find(run => run.provider_account_id === row.id)?.status === "completed").map(row => row.provider));
  return <>
    <PageTitle title="אינטגרציות" description="מקורות חיוב, הרשאות קריאה והיסטוריית סנכרון." icon={Plug}>
      <TextLink to={href("/invoices",{ month })}>העלאת מסמכי ספק</TextLink>
      {owner && <Add path="/integrations" month={month} kind="account">חשבון ספק חדש</Add>}
    </PageTitle>
    <Flash search={search}/>
    {owner && <FormPanel {...directory} path="/integrations" kind={search.add === "account" ? "account" : undefined} month={month}/>}
    <Metrics metrics={[
      { label: "מקורות חיוב", value: providerCatalog.length, detail: "קטלוג ספקים", icon: Plug },
      { label: "חשבונות מוגדרים", value: accounts.length, detail: "רק בסביבת העבודה הנוכחית", icon: Building2 },
      { label: "מקורות עם סנכרון שהושלם", value: active.size, detail: "לפי הריצה האחרונה הגלויה", icon: CircleCheck },
      { label: "ריצות שנכשלו", value: runs.filter(run => run.status === "failed").length, detail: "מתוך 30 הריצות האחרונות", icon: TriangleAlert, tone: "coral" },
    ]}/>
    <Panel title="מקורות נתונים"><DataTable headings={["מקור","נתונים","סטטוס","סנכרון אחרון"]}>{providerCatalog.map(([key, label, scope]) => {
      const account = accounts.find(row => row.provider === key);
      const run = runs.find(row => row.provider_account_id === account?.id);
      const tone = run?.status === "completed" ? "good" : run?.status === "failed" ? "bad" : "neutral";
      const text = run ? statusText[run.status] : account ? "ממתין לסנכרון" : adapterProviders.has(key) ? "לא הוגדר" : "נדרש מקור חשבונית או חיבור";
      return <tr key={key}><td><bdi>{label}</bdi></td><td>{scope}</td><td><Chip tone={tone}>{text}</Chip></td><td>{run ? displayDate(run.started_at) : "—"}</td></tr>;
    })}</DataTable></Panel>
    <Panel title="היסטוריית סנכרון">
      {runs.length ? <DataTable headings={["תאריך","מקור","סטטוס","רשומות","פרטים"]}>{runs.map(run => <tr key={run.id}>
        <td>{displayDate(run.started_at)}</td><td>{providerCatalog.find(row => row[0] === accounts.find(account => account.id === run.provider_account_id)?.provider)?.[1] ?? "—"}</td>
        <td>{statusText[run.status]}</td><td>{run.observed_count}</td><td>{reasonText[run.reason ?? ""] ?? "—"}</td>
      </tr>)}</DataTable> : <Blank>טרם נרשמו ריצות סנכרון.</Blank>}
    </Panel>
  </>;
}

async function Settings({ access, search, month }: View) {
  const { business } = access.data;
  const audit = access.data.audit.slice(0,12);
  const alerts = access.data.alerts.slice(0,20);
  const owner = access.role === "owner";
  return <>
    <PageTitle title="הגדרות" description="פרטי העסק, אבטחה, הרשאות והתראות." icon={SettingsIcon}/>
    <Flash search={search}/>
    <div className="settings-grid">
      <Panel title="פרטי החברה וסביבת העבודה"><form className="field-stack" action={mutate.bind(null, "settings")}>
        <FormFields path="/settings" month={month}/>
        <div className="form-grid"><label>שם העסק<input name="name" defaultValue={business.name} disabled={!owner} required/></label>
          <label>ח.פ. או עוסק<input name="number" defaultValue={business.business_number ?? ""} disabled={!owner}/></label>
          <label>דואר אלקטרוני עסקי<input type="email" name="email" dir="ltr" defaultValue={business.contact_email ?? ""} disabled={!owner}/></label>
          <label>סף התראה להוצאה בש״ח<input name="threshold" inputMode="decimal" dir="ltr" defaultValue={business.alert_threshold_minor ? business.alert_threshold_minor / 100 : ""} disabled={!owner}/></label></div>
        {owner && <button className="button primary">שמור שינויים</button>}
      </form></Panel>
      <Panel title="אבטחה והרשאות" action={<ShieldCheck size={20} aria-hidden="true"/>}>
        <dl className="info-list"><div><dt>חשבון מחובר</dt><dd><bdi>{access.user.email}</bdi></dd></div>
          <div><dt>הרשאה</dt><dd>{{ owner:"בעלים", editor:"עורך", viewer:"צופה" }[access.role] ?? "—"}</dd></div>
          <div><dt>אימות דו־שלבי</dt><dd><Chip tone="good">פעיל</Chip></dd></div>
          <div><dt>מסמכי מקור</dt><dd>אחסון פרטי</dd></div></dl>
      </Panel>
      <Panel title="העדפות פיננסיות">
        <dl className="info-list"><div><dt>מטבע תצוגה</dt><dd>שקל חדש</dd></div><div><dt>אזור זמן</dt><dd><bdi>Asia/Jerusalem</bdi></dd></div>
        <div><dt>תאריך עסקי נוכחי</dt><dd>{displayDate(businessDate())}</dd></div><div><dt>סיווג הוצאה חדשה</dt><dd>נדרשת בדיקת מס</dd></div></dl>
      </Panel>
      <Panel title="חיבורים וסנכרון"><TextLink to={href("/integrations",{month})}>ניהול אינטגרציות</TextLink><p>ריצות סנכרון ומצב הרשאות זמינים במסך האינטגרציות.</p></Panel>
    </div>
    <div id="notifications"><Panel title="התראות">
      {alerts.length ? <DataTable headings={["התראה","תאריך"]}>{alerts.map(item => <tr key={item.id}><td>{item.code === "charge_threshold" ? "הוצאה עברה את הסף שהוגדר" : "מקור ספק שינה חיוב שכבר אומת"}</td><td>{displayDate(item.created_at)}</td></tr>)}</DataTable> : <Blank>אין התראות בסביבת העבודה.</Blank>}
    </Panel></div>
    <Panel title="יומן ביקורת">
      {audit.length ? <DataTable headings={["תאריך","רשומה","פעולה"]}>{audit.map(item => <tr key={item.id}>
        <td>{displayDate(item.created_at)}</td><td><bdi>{item.entity}</bdi></td><td>{{ INSERT:"הוספה",UPDATE:"עדכון",DELETE:"מחיקה" }[item.operation as "INSERT" | "UPDATE" | "DELETE"] ?? "—"}</td>
      </tr>)}</DataTable> : <Blank>טרם נרשמו פעולות.</Blank>}
    </Panel>
  </>;
}
