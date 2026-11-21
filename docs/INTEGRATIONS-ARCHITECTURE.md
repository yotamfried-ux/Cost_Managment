# D2R Management — Connectors, accounting and deployment architecture

## Source-of-truth precedence
1. Source invoice / receipt from vendor (final paid amount, original currency and billing period).
2. Vendor Billing API (provider-reported billing; may include pending/provisional data).
3. Usage API + official price schedule (estimate clearly labeled).
4. User-entered estimate with provenance; never silently promote to confirmed.
Import via Gmail is a **document ingestion source**, not a second charge to be summed. Reconcile using vendor account, invoice number, billing period, amount/currency, payment reference and SHA256.

## Provider adapters
Expose:
\`\`\`ts
interface CostConnector {
  provider: string;
  discoverAccounts(): Promise<ProviderAccount[]>;
  getCapabilities(): ConnectorCapabilities;
  syncUsage(cursor?: string): Promise<UsageBatch>;
  syncCosts(cursor?: string): Promise<CostBatch>;
  syncDocuments(cursor?: string): Promise<DocumentBatch>;
  validateConnection(): Promise<ConnectorHealth>;
}
\`\`\`
Some operations are optional; absence must show \`UNSUPPORTED\`, not a fake successful sync.

### Sources
- Vercel: billing charges/usage API, actual team/project lookup, official invoice source; track unit and project.
- Supabase: organization and project usage, subscription; invoice via email where API unavailable.
- Hetzner: Cloud API for VPS resources + invoice via Gmail. n8n self-hosted is not another vendor fee.
- GitHub: Actions usage/limits and Billing endpoints subject to permissions.
- Google Cloud Billing for Gemini API: identify real project/Billing Account; enable authorized export to BigQuery if requested. Google AI Pro subscription is separate.
- Claude Pro personal subscription: receipt from authenticated billing portal/email; Claude model API spend is a separate provider account. Do not assume USD amount.
- OpenAI API vs ChatGPT Plus: separate accounts/ledger categories.
- Cloudflare: R2/Stream usage + invoice, where linked to SportReel.
- Gmail: supplier receipt discovery, strict sender/document verification; avoid arbitrary mail ingestion.
- OpenRouter/Resend/Upstash/Namecheap and other APIs: capability check and price/usage.
No writes to vendor billing or credential scope changes without approval.

## Idempotent ingest pipeline
\`provider API/Gmail -> raw_events -> normalize -> deduplicate -> reconcile -> allocate -> reporting\`.
Use immutable raw payload hashes and versioned normalized ledger; audit every manual override. An invoice paid by card is one charge: don't double-count invoice and card transactions. Reconciliation state machine: \`UNMATCHED\`, \`CANDIDATE\`, \`MATCHED\`, \`DISPUTED\`, \`REVIEW_REQUIRED\`.
Store source immutable PDFs in **private encrypted object storage** with permissions; keep digest and vendor identifiers. No raw financial secrets in logs.

## Modular money flows
\`\`\`ts
interface PaymentProvider {
  providerId: string;
  createCheckout(input: CheckoutRequest): Promise<CheckoutResult>;
  fetchPayment(id: string): Promise<PaymentStatus>;
  refund(input: RefundRequest): Promise<RefundResult>;
  verifyWebhook(payload: Uint8Array, headers: Record<string,string>): Promise<PaymentEvent>;
}
interface InvoiceProvider {
  providerId: string;
  issueDocument(input: IssueDocumentRequest): Promise<OfficialDocument>;
  fetchDocument(id: string): Promise<OfficialDocument>;
  fetchPdf(id: string): Promise<Uint8Array>;
  verifyWebhook(payload: Uint8Array, headers: Record<string,string>): Promise<InvoiceEvent>;
}
\`\`\`
Define adapters for \`NullProvider\` in tests and future \`SUMIT\`/\`Grow\`/other only when selected. No live document issuance in MVP. Configurable customer/tenant level routing, strong idempotency keys, payment/invoice linkage, refunds, errors and compensating workflows.

## Data-model tables
\`organizations\`, \`users\`, \`projects\`, \`suppliers\`, \`provider_accounts\`, \`subscriptions\`, \`usage_events\`, \`cost_events\`, \`charges\`, \`invoices\`, \`invoice_documents\`, \`payments\`, \`reconciliation_matches\`, \`exchange_rates\`, \`cost_allocation_rules\`, \`cost_allocations\`, \`sync_runs\`, \`webhook_events\`, \`revenue_events\`, \`customers\`, \`refunds\`, \`notifications\`, \`audit_log\`, \`feature_flags\`.
Add unique external IDs and indexed invoice number+supplier+period; encrypt PII/credentials. Avoid duplicate monthly totals with billing periods vs event timestamps.

## Deployment planning
- New Vercel project **linked to the existing private repository** \`yotamfried-ux/Cost_Managment\`; **project display name** \`d2r-management\` (or Vercel-safe equivalent). Do not create a different GitHub repository.
- Use existing Vercel team/plan; ensure new charges are approved. Next.js App Router, TS, production env vars through Vercel secrets, preview/prod isolation.
- Reuse existing n8n self-hosted Hetzner only if appropriate authenticated connector endpoint exists; network boundary/private secrets, no browser-direct credentials.
- PostgreSQL separated by database/schema/user; compare existing Hetzner instance vs Supabase before choosing.
- Production domain \`finance.d2ryf.com\`: create domain association after Vercel project exists and obtain provider-specific DNS target. Namecheap Host=\`finance\`, Type=\`CNAME\`, Value=**Vercel-provided exact target**, TTL=Automatic; verification TXT only if requested. Do not change root DNS/MX/nameservers. User planned to handle Namecheap after Vercel gives values.
- HTTPS and domain validation; auth/authorization prior to exposing real data.
- Preview, test, QA and owner approval gate before Production. No unsupported claim of successful deployment.

## Required acceptance tests
1. Cross-provider expense ingestion yields accurate double-entry reconciliation and no duplication.
2. FX amounts preserved, date windows accurately computed in Asia/Jerusalem.
3. No leaked passwords/tokens, no public access to receipts, minimum permission scopes.
4. Project cost shares sum to real source charge; unallocated visible; no cross-project phantom charges.
5. Dashboard data fresh/stale/estimate states backed by source and timestamp.
6. Backup can be restored; imported documents hashes unchanged.
7. Mock provider plugins cannot issue real documents/payments.
8. PR/test/build/live preview gates and recorded proof before merge/deploy.
