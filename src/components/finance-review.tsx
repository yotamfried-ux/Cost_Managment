import { providerCatalog } from "@/lib/connectors";
import { evidenceLabels, formatMoney } from "@/lib/finance";
import { includedStatus, unassigned, type Access, type Summary } from "@/lib/queries";
import { Blank, Chip, DataTable, formatAmount, href, Panel, TextLink } from "./dashboard";

export function FinanceReview({ access, month, totals }: { access: Access; month: string; totals: Summary }) {
  const { data } = access;
  const confirmedReceipts = new Set((data.inboxReceipts ?? []).filter(row => row.paymentData?.kind === "receipt")
    .map(row => row.supportingInvoiceId ?? row.id));
  const pending = data.invoices.filter(row => row.issued_on.startsWith(month) && (row.status === "review" || !confirmedReceipts.has(row.id)))
    .sort((a, b) => b.issued_on.localeCompare(a.issued_on));
  const names = new Map(data.suppliers.map(row => [row.id, row.name]));
  const failedKeys = new Set(data.accounts.filter(account => data.runs.find(run => run.provider_account_id === account.id)?.status === "failed")
    .map(account => account.provider));
  const failed = providerCatalog.filter(([key]) => failedKeys.has(key)).map(([, name]) => name);
  const gmail = data.gmailRuns?.[0]?.status;
  const needsFx = totals.evidence.filter(row => row.name === "verified" || row.name === "provider" || row.name === "manual")
    .reduce((sum, row) => sum + row.fx_missing, 0);
  const assigned = totals.projects.length ? totals.projects.reduce((sum, row) => sum + row.total, 0) : null;
  const expenseDetails = (filters: { project?: string; status?: string }) =>
    href("/expenses", { month, view: "transactions", ...filters }) + "#expense-transactions";

  return <div className="split parallel">
    <Panel title="איך מורכב הסכום החודשי">
      <DataTable headings={["מקור החיוב", "סכום בש״ח", "פירוט"]}>
        {(["verified", "provider", "manual"] as const).map(evidence => {
          const row = totals.evidence.find(item => item.name === evidence);
          return <tr key={evidence}>
            <th scope="row">{evidence === "verified" ? "מאומת במסמך" : evidenceLabels[evidence]}</th>
            <td><bdi>{formatAmount(row?.total)}</bdi></td>
            <td>{row && <TextLink to={expenseDetails({ status: evidence })}>לתנועות</TextLink>}</td>
          </tr>;
        })}
        <tr><th scope="row">שויך לפרויקטים</th><td><bdi>{formatAmount(assigned)}</bdi></td>
          <td><TextLink to={href("/projects", { month })}>לפרויקטים</TextLink></td></tr>
        <tr><th scope="row">משותף או ללא שיוך</th><td><bdi>{formatAmount(totals.unallocated)}</bdi></td>
          <td><TextLink to={expenseDetails({ project: unassigned, status: includedStatus })}>לתנועות</TextLink></td></tr>
      </DataTable>
    </Panel>
    <Panel title="מה דורש טיפול"
      action={pending.length > 0 ? <TextLink to={href("/invoices", { month }) + "#invoice-documents"}>לכל החשבוניות</TextLink> : undefined}>
      {pending.length ? <DataTable headings={["ספק", "סכום חשבונית", "מצב"]}>
        {pending.slice(0, 4).map(row => <tr key={row.id}>
          <th scope="row"><TextLink to={href("/invoices", { month, invoice: row.id }) + "#invoice-documents"}>
            {names.get(row.supplier_id) ?? "פתיחת חשבונית"}</TextLink></th>
          <td><bdi>{formatMoney(row.amount_minor, row.currency)}</bdi></td>
          <td><Chip tone="pending">{confirmedReceipts.has(row.id) ? "יש קבלה · נדרשת התאמה" : "חסרה אסמכתת תשלום מזוהה"}</Chip></td>
        </tr>)}
      </DataTable> : <Blank>אין חשבוניות שממתינות להתאמה או לאימות תשלום בחודש שנבחר.</Blank>}
      {needsFx > 0 && <p className="notice">{needsFx} חיובים חסרים שער המרה ולכן מוצגים במטבע המקורי.</p>}
      {(failed.length > 0 || gmail === "failed" || gmail === "partial") && <p className="notice">
        {failed.length > 0 && <>סנכרון אחרון נכשל עבור <bdi>{failed.join(", ")}</bdi>. </>}
        {gmail === "failed" ? "קליטת Gmail האחרונה נכשלה. " : gmail === "partial" ? "קליטת Gmail האחרונה הייתה חלקית. " : ""}
        <TextLink to={href("/integrations", { month })}>לסטטוס החיבורים</TextLink>
      </p>}
    </Panel>
  </div>;
}
