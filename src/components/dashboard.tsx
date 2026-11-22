import Link from "next/link";
import { ArrowLeft, ArrowRight, FileText, Plus, Download, type LucideIcon } from "lucide-react";
import { formatMoney, evidenceLabels, shekels } from "@/lib/finance";
import { pageNumber, pageSize, type Charge, type Invoice, type Search, type Subscription } from "@/lib/queries";

export const absent = "—";
export const categoryNames = ["תשתיות ענן", "כלי AI", "פיתוח והרצה", "דומיינים ואירוח", "כלים עסקיים", "פרסום", "אחרות"];
export const displayDate = (date: string) => new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(date.length === 10 ? date + "T12:00:00Z" : date));
export const formatAmount = (value: number | null | undefined) => value === undefined || value === null ? absent : shekels(value);

export function href(path: string, search: Search, overrides: Search = {}) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries({ ...search, error: undefined, saved: undefined, add: undefined, ...overrides })) {
    if (value) params.set(name, value);
  }
  return params.size ? `${path}?${params}` : path;
}

export function PageTitle({ title, description, icon: Icon, children }: { title: string; description?: string; icon: LucideIcon; children?: React.ReactNode }) {
  return <div className="page-heading"><div><h1><Icon aria-hidden="true" size={28}/>{title}</h1>{description && <p>{description}</p>}</div>
    {children && <div className="page-actions">{children}</div>}
  </div>;
}

export function Add({ path, month, kind, children }: { path: string; month: string; kind: string; children: React.ReactNode }) {
  return <Link className="button primary" href={href(path, { month }, { add: kind })} scroll={false}><Plus size={17} aria-hidden="true"/>{children}</Link>;
}

export function Export({ search }: { search: Search }) {
  return <a className="button" href={href("/api/export", search)}><Download size={16} aria-hidden="true"/>ייצוא נתונים</a>;
}

export type Metric = { label: string; value: number | string; detail: string; icon: LucideIcon; tone?: "coral" | "mint" | "neutral" };
export function Metrics({ metrics }: { metrics: Metric[] }) {
  return <section className="metrics" aria-label="מדדים מרכזיים">{metrics.map(({ label, value, detail, icon: Icon, tone = "mint" }) =>
    <article className={`panel metric ${tone}`} key={label}><span className="metric-icon"><Icon size={22} aria-hidden="true"/></span><div>
      <h2>{label}</h2><strong><bdi>{value}</bdi></strong><p>{detail}</p>
    </div></article>)}</section>;
}

export function Panel({ title, action, children, className = "" }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <section className={`panel content-panel ${className}`}><div className="panel-heading"><h2>{title}</h2>{action}</div>{children}</section>;
}

export function TextLink({ to, children }: { to: string; children: React.ReactNode }) {
  return <Link href={to} className="text-link">{children}<ArrowLeft size={14} aria-hidden="true"/></Link>;
}

export function Blank({ children = "אין נתונים לתקופה שנבחרה" }: { children?: React.ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Chip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "good" | "bad" | "pending" | "neutral" }) {
  return <span className={`chip ${tone}`}>{children}</span>;
}
export function Flash({ search }: { search: Search }) {
  return search.error ? <p className="notice" role="alert">{search.error === "permission" ? "לא הוקצתה הרשאת עריכה." : search.error === "validation" ? "יש לבדוק את השדות ולנסות שוב." : "השמירה נכשלה. בדקו אם הרשומה כבר קיימת או אם הפרטים תואמים."}</p>
    : search.saved ? <p className="notice success" role="status">השינויים נשמרו.</p> : null;
}

export function DataTable({ headings, children }: { headings: string[]; children: React.ReactNode }) {
  return <div className="table-scroll" tabIndex={0} role="region" aria-label={headings.join(", ")}><table><thead><tr>
    {headings.map(heading => <th scope="col" key={heading}>{heading}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}

export function Charges({ rows, compact = false, projectShare = false }: { rows: Charge[]; compact?: boolean; projectShare?: boolean }) {
  if (!rows.length) return <Blank>אין הוצאות שתואמות לתקופה ולמסננים.</Blank>;
  return <DataTable headings={["תאריך","ספק","תיאור","פרויקט",...(compact ? [] : ["קטגוריה"]),"סכום",...(projectShare ? ["חלק יחסי במטבע המקורי","חלק יחסי בש״ח"] : []),"סטטוס","מסמך"]}>
    {rows.map(row => <tr key={row.id}>
      <td>{displayDate(row.recorded_on)}</td><td>{row.suppliers?.name ?? absent}</td><td>{row.description}</td>
      <td>{row.cost_allocations.map(item => item.projects?.name).filter(Boolean).join(", ") || absent}</td>
      {!compact && <td><Chip>{row.category}</Chip></td>}
      <td><bdi>{row.amount_minor === null ? absent : formatMoney(row.amount_minor, row.currency)}</bdi></td>
      {projectShare && <td><bdi>{row.project_share_minor == null ? absent : formatMoney(row.project_share_minor, row.currency)}</bdi></td>}
      {projectShare && <td><bdi>{formatAmount(row.project_share_ils)}</bdi></td>}
      <td><Chip tone={row.evidence === "verified" ? "good" : row.evidence === "estimate" ? "pending" : "neutral"}>{evidenceLabels[row.evidence]}</Chip></td>
      <td>{row.reconciliation_matches ? <Link className="icon-button" href={`/api/documents/${row.reconciliation_matches.invoice_id}`} aria-label="הורדת מסמך מקור"><FileText size={15}/></Link> : absent}</td>
    </tr>)}
  </DataTable>;
}

export function InvoiceRows({ rows, search }: { rows: Invoice[]; search: Search }) {
  if (!rows.length) return <Blank>אין חשבוניות שתואמות לתקופה ולמסננים.</Blank>;
  return <DataTable headings={["מספר חשבונית","ספק","תאריך","סכום","סטטוס"]}>{rows.map(row => <tr key={row.id} className={search.invoice === row.id ? "selected-row" : undefined}>
    <td><Link className="text-link" href={href("/invoices", search, { invoice: row.id })}><bdi>{row.invoice_number}</bdi></Link></td>
    <td>{row.suppliers?.name ?? absent}</td><td>{displayDate(row.issued_on)}</td><td><bdi>{formatMoney(row.amount_minor, row.currency)}</bdi></td>
    <td><Chip tone={row.status === "matched" ? "good" : "pending"}>{row.status === "matched" ? "מותאם" : "לבדיקה"}</Chip></td>
  </tr>)}</DataTable>;
}

const cycles: Record<string, string> = { monthly: "חודשי", annual: "שנתי", usage: "לפי שימוש" };
const states: Record<string, string> = { active: "פעיל", paused: "מושהה", ended: "הסתיים" };
export function SubscriptionRows({ rows, upcoming = false }: { rows: Subscription[]; upcoming?: boolean }) {
  if (!rows.length) return <Blank>{upcoming ? "אין חיובים מתוכננים ב־14 הימים הקרובים." : "טרם נוספו מנויים."}</Blank>;
  return <DataTable headings={["ספק","מנוי","סכום", ...(upcoming ? [] : ["תדירות"]), "חיוב הבא","סטטוס"]}>{rows.map(row => <tr key={row.id}>
    <td>{row.suppliers?.name ?? absent}</td><td>{row.label}</td><td><bdi>{row.amount_minor === null ? absent : formatMoney(row.amount_minor, row.currency)}</bdi></td>
    {!upcoming && <td>{cycles[row.cycle]}</td>}<td>{row.next_charge_on ? displayDate(row.next_charge_on) : absent}</td>
    <td><Chip tone={upcoming ? "pending" : row.status === "active" ? "good" : "neutral"}>{upcoming ? "התחייבות" : states[row.status]}</Chip></td>
  </tr>)}</DataTable>;
}

export function Pagination({ path, search, total }: { path: string; search: Search; total: number }) {
  const page = pageNumber(search.page);
  const last = Math.ceil(total / pageSize);
  if (last < 2 && page === 1) return null;
  return <nav className="pagination" aria-label="דפדוף">
    <span>עמוד {page} מתוך {Math.max(1, last)}</span>
    <div>
      {page > 1 && <Link className="button" href={href(path, search, { page: String(Math.min(page - 1, Math.max(last, 1))) })}><ArrowRight size={16} aria-hidden="true"/>הקודם</Link>}
      {page < last && <Link className="button" href={href(path, search, { page: String(page + 1) })}>הבא<ArrowLeft size={16} aria-hidden="true"/></Link>}
    </div>
  </nav>;
}
