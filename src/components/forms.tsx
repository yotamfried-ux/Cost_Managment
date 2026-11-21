import Link from "next/link";
import { randomUUID } from "node:crypto";
import { X } from "lucide-react";
import { mutate } from "@/app/finance-actions";
import { businessDate, currencies } from "@/lib/finance";
import type { Project, Supplier } from "@/lib/queries";
import type { InboxReceipt } from "@/lib/repository";
import { providerCatalog } from "@/lib/connectors";
import { categoryNames } from "./dashboard";

const titles: Record<string, string> = {
  expense: "הוספת הוצאה", project: "פרויקט חדש", invoice: "העלאת חשבונית",
  subscription: "מנוי חדש", supplier: "ספק חדש", fx: "עדכון שער המרה", account: "חשבון ספק חדש",
};

export function FormFields({ path, month }: { path: string; month: string }) {
  return <><input type="hidden" name="return" value={path}/><input type="hidden" name="month" value={month}/></>;
}
export function FormPanel({ kind, path, month, projects, suppliers, receipt, candidates = [] }: {
  kind?: string; path: string; month: string; projects: Project[]; suppliers: Supplier[];
  receipt?: InboxReceipt;
  candidates?: { id: string; description: string; recorded_on: string }[];
}) {
  if (!kind || !titles[kind]) return null;
  const canSubmit = (!(kind === "invoice" || kind === "subscription" || kind === "account") || suppliers.length > 0) && (kind !== "fx" || candidates.length > 0);
  return <section className="panel content-panel inline-form" aria-labelledby="add-heading">
    <div className="panel-heading"><h2 id="add-heading">{titles[kind]}</h2><Link className="icon-button" aria-label="סגירה" href={`${path}?month=${month}`}><X size={18}/></Link></div>
    <form action={mutate.bind(null, kind)}>
      <FormFields path={path} month={month}/>
      <div className="form-grid">
        {kind === "expense" && <>
          <input type="hidden" name="request" value={randomUUID()}/>
          <label>תיאור<input name="description" required maxLength={240}/></label>
          <label>תאריך<input type="date" name="recorded" defaultValue={businessDate().startsWith(month) ? businessDate() : month + "-01"} required/></label>
          <Category/><SupplierPicker rows={suppliers} optional/>
          <label>פרויקט<select name="project" defaultValue=""><option value="">ללא שיוך</option>{projects.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <label>מקור<select name="evidence"><option value="estimate">אומדן ידני</option><option value="missing">סכום חסר</option></select></label>
          <MoneyFields/>
        </>}
        {kind === "project" && <>
          <label>שם פרויקט<input name="name" required maxLength={100}/></label>
          <label>תיאור<input name="description" maxLength={400}/></label>
          <label>סטטוס<select name="status"><option value="active">פעיל</option><option value="planned">בתכנון</option><option value="archived">בארכיון</option></select></label>
          <label>תקציב חודשי בש״ח<input name="budget" inputMode="decimal" dir="ltr"/></label>
        </>}
        {kind === "supplier" && <><label>שם ספק<input name="name" required maxLength={100}/></label><Category/></>}
        {kind === "subscription" && <>
          <SupplierPicker rows={suppliers}/><label>שם מנוי<input name="label" required maxLength={120}/></label>
          <label>תדירות<select name="cycle"><option value="monthly">חודשי</option><option value="annual">שנתי</option><option value="usage">לפי שימוש</option></select></label>
          <label>תאריך חיוב הבא<input name="next" type="date"/></label><MoneyFields/>
        </>}
        {kind === "invoice" && <>
          <SupplierPicker rows={suppliers}/><label>מספר חשבונית<input name="number" required maxLength={100}/></label>
          <label>תאריך חשבונית<input type="date" name="issued" required/></label>
          {receipt ? <>
            <input type="hidden" name="receipt" value={receipt.id}/>
            <div className="receipt-download"><span>מסמך מקור</span><a className="button" href={`/api/documents/${receipt.id}`}>הורדת PDF מהתיבה</a></div>
          </> : <label>קובץ PDF עד 4 MB<input type="file" name="file" accept="application/pdf" required/></label>}
          <MoneyFields required/>
        </>}
        {kind === "account" && <>
          <SupplierPicker rows={suppliers}/><label>מקור נתונים<select name="provider">{providerCatalog.map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>מזהה חשבון אצל הספק<input name="external" dir="ltr" maxLength={160} required/></label>
        </>}
        {kind === "fx" && <>
          <label>הוצאה<select name="charge" required>{candidates.map(row => <option key={row.id} value={row.id}>{row.description} · {row.recorded_on}</option>)}</select></label>
          <label>שער בש״ח ליחידת מטבע<input name="quote" dir="ltr" inputMode="decimal" required/></label>
          <label>תאריך פרסום השער<input name="quoted" type="date" required/></label><label>מקור<input name="source" required maxLength={180}/></label>
        </>}
      </div>
      {!canSubmit && <p className="notice">{kind === "fx" ? "אין הוצאות במטבע זר בתוצאות הנוכחיות." : "תחילה יש להוסיף ספק במסך הספקים."}</p>}
      <button className="button primary" disabled={!canSubmit}>שמירה</button>
    </form>
  </section>;
}

function SupplierPicker({ rows, optional = false }: { rows: Supplier[]; optional?: boolean }) {
  return <label>ספק<select name="supplier" required={!optional} defaultValue=""><option value="">{optional ? "ללא ספק" : "בחירת ספק"}</option>
    {rows.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
  </select></label>;
}
function Category() {
  return <label>קטגוריה<select name="category">{categoryNames.map(name => <option key={name}>{name}</option>)}</select></label>;
}
function MoneyFields({ required = false }: { required?: boolean }) {
  return <>
    <label>סכום<input name="amount" inputMode="decimal" dir="ltr" required={required}/></label>
    <label>מטבע<select name="currency" defaultValue="ILS" dir="ltr">{currencies.map(currency => <option key={currency}>{currency}</option>)}</select></label>
  </>;
}
