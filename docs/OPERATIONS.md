# Operations

## Configuration and deployment

Apply the checked-in Supabase migrations to a dedicated Preview database and a separate Production database. In hosted Supabase disable open signups, enable TOTP, invite the owner and assign a membership; keep service keys out of interactive shells and browser sessions. Keep preview test data isolated and labeled. Verify backup retention and a restore to a disposable target before production.

Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` by environment. Preview without these variables serves a locked sign-in screen. `/api/health` measures application availability. Run authenticated smoke tests separately to verify stored finance data and storage permissions.

The daily schedule calls `/api/sync`. Set `CRON_SECRET`, `SUPABASE_SECRET_KEY`, and `D2R_SYNC_ORG_ID` only on the intended environment. Add one row in `provider_accounts` for each approved vendor account with its matching `supplier_id`. The adapter's server credential and provider account row are both required. The current deployment contract supports one scheduled workspace. Verify the actual source account, latest run, narrowed scope and sample totals before declaring a connector live.

| Source | Current path |
| --- | --- |
| OpenAI API | Organization Costs API adapter. Uses the official admin key endpoint. ChatGPT Plus receipts are tracked separately. |
| Anthropic API | Organization Cost Report adapter. Uses the official admin key endpoint. It cannot read Claude Pro receipts. |
| GitHub | Organization billing usage adapter. Imports net billable data. Supports organizations with enabled billing endpoints and qualified token access. |
| Google Cloud / Gemini | BigQuery billing export adapter with tracked project, explicit approved SKU IDs, parameterized query and required byte cap. Requires existing billing export and permission to run jobs. Google AI Pro is separate. |
| Claude Pro | Upload original vendor or app-store receipt and reconcile. Prefer the authenticated Claude Billing view or a verified receipt email. |
| Vercel, Supabase, Hetzner, Gmail, Cloudflare, OpenRouter, Resend, Namecheap | Manual PDF intake and reconciliation. Automatic vendor sources are pending validation and adapter work. |

A connector can be validated in isolation with a read-only cost retrieval against a nominated vendor account, then against authoritative vendor totals. Verify what the credential actually permits. BigQuery query jobs may incur costs; enforce the configured cap and obtain approval before enabling. No connector is reported as live from configuration alone.

## Release and open scope

Preview must be verified with an isolated backend and authenticated browser sessions. Get explicit production approval before enabling a live data environment or routing traffic to the domain. Use Vercel's project-specific domain configuration to retrieve the exact DNS record and report it to the owner. The owner handles Namecheap.

This build includes manual expense intake, private PDF upload and explicit reconciliation, project drill-down, manual FX, threshold alerts, CSV reporting, usage adapter contracts, and authorization-aware views. Future-scope work includes automated Gmail intake, other supplier adapters, invoice OCR and export bundles, XLSX/PDF reports, richer budgeting and allocation UI, backup/restore evidence, and live credentials or dataset validation.
