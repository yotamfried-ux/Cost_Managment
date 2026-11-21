# Operations

## Repository storage and access

The Vercel server writes AES-256-GCM encrypted ledger snapshots and PDF files to a private Git branch using the GitHub Git Data API. The ledger and document are published together in a single non-forced ref update. Stale updates are retried against the latest state. Financial values, file names and vendor account IDs remain inside encrypted blobs. Git still exposes commit dates, ciphertext sizes and opaque document IDs to collaborators with repository access. Git history retains encrypted older versions.

Preview uses `d2r-preview-data`. Production uses `d2r-data`. Use different data keys, session keys, accounts and contents tokens across environments. The configured key must be backed up outside Git along with access to the private branch. A key change requires a controlled re-encryption procedure. Restore to an isolated branch and verify both ledger and PDF hashes before restoring operational access.

1. Generate owner credentials on a trusted machine using `npx tsx scripts/create-workspace-access.ts OWNER_EMAIL /absolute/new/private/directory`.
2. Set the three generated configuration values in the intended Vercel environment as sensitive variables. Keep the owner's password and TOTP setup key in their password manager.
3. Set `D2R_REPO_TOKEN` as a sensitive Vercel variable. Use a fine-grained GitHub token limited to the private Cost_Managment repository and Contents read/write, with the shortest sustainable expiry. Do not store it in Git or send it in chat. The token is repository-scoped, so apply normal branch protection to code branches and keep the data-branch writer list small.
4. Start with an empty encrypted Preview branch. Sign in using the Preview owner and verify storage, access roles, download permissions and restore. Keep vendor tokens and real finance records in Production.
5. Maintain a Vercel security rate limit at the hosting perimeter before enabling Production. The app has per-instance attempt limits and durable one-time-code replay protection.

Ledger snapshots are bounded to 670 KB compressed and 8 MB uncompressed. PDF uploads are limited to 4 MB. This is a single workspace with a low write rate. Capacity and a tested migration should be reviewed as records or collaborators grow.

## Cost data sources

The daily scheduler calls `/api/sync` only when `CRON_SECRET` is set. Configure a vendor account using the owner interface and supply its dedicated credentials in the intended environment. Report a source as connected only after its read scope, latest run and source totals are verified.

| Source | Current path |
| --- | --- |
| Vercel | Official Team Billing FOCUS JSONL endpoint. Imports billed cost in USD for the verified team. Team-level totals have no project attribution. |
| OpenAI API | Organization Costs API. ChatGPT Plus receipts are separate. |
| Anthropic API | Organization Cost Report in cents. Claude Pro receipts are separate. |
| GitHub | Organization billing usage. Imports net billable usage for eligible organizations. |
| Google Cloud / Gemini | BigQuery export with selected project and explicit SKU allowlist. Requires an existing billing export and approved read/job permissions. Enable only after approving potential query charges and setting the required scanned-byte cap. |
| Claude Pro | Original receipt from Claude Billing or the app store via private PDF upload and reconciliation. |
| Gmail | Optional private receipt staging from a dedicated label, allowlisted senders and aligned DKIM. A reviewer must confirm supplier, invoice number, date and amount before reconciliation. |
| Supabase, Hetzner, Cloudflare, OpenRouter, Resend, Namecheap | Manual PDF intake and reconciliation are available. Automated sources await implementation or account validation. |

For Gmail, authorize a read-only OAuth token against the intended mailbox. Configure the dedicated label ID (e.g. the Gmail API `Label_...` identifier) and JSON entries with exact `email` and `dkim` values for known senders. The scheduler scans recent matching PDF attachments in that label and stages the original encrypted bytes. Gmail receipts do not become ledger charges automatically.

Each API cost has a stable billing key. A replay of the same version does not duplicate ledger entries. Changed provider totals retain prior provenance and are flagged if the charge has already been verified. Amount/date scope varies by vendor. Reconciliation currently matches a single charge to a single invoice and offers candidate selection from the invoice month.

## Release and open scope

The application has a health route and a locked sign-in screen when credentials are missing. Verify authenticated Preview workflows before requesting explicit Production approval. Obtain the exact DNS target from the Vercel project domain settings. The owner manages Namecheap records.

The current scope includes manual expense and supplier intake, encrypted PDF upload and download, explicit reconciliation, project drill-down, manual FX, threshold alerts, CSV reporting, and disabled account/payment/invoice contracts. Remaining work includes further supplier adapters and live Gmail receipt validation, provider credential validation, invoice OCR, invoice bundles and XLSX/PDF report formats, multi-project allocations and richer forecasts, restore drills, and authenticated hosted Preview/Production verification.
