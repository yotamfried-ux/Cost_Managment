# Codex execution prompt — D2R Management

> **Precondition:** this prompt is executed **only after** owner explicitly says to start the build. Drafting and merging documentation does NOT authorize production deployment.

You are Codex with authorized access to GitHub, Vercel, n8n, and necessary read-only billing accounts. **Build and deploy a secure FinOps + Business Finance system** from the existing repo \`yotamfried-ux/Cost_Managment\` with app branding **D2R Management** and planned domain \`finance.d2ryf.com\`.

## Source-of-truth ordering
1. The owner's **original approved screenshot (ניהול העסק)** supplied 21 Nov 2026, saved as \`design/reference/approved-home.png\` once uploaded. **Do not redesign the homepage.**
2. This repository: \`docs/PRODUCT-SPEC.md\`, \`docs/DESIGN-SYSTEM.md\`, \`docs/INTEGRATIONS-ARCHITECTURE.md\`.
3. Engineering-OS \`AGENTS.md\`, \`docs/ui-ux/\`, \`templates/admin-dashboard/\`, \`external-skills/ui-ux-pro-max/\`, \`patterns/ui/\`, \`patterns/billing/\`.
4. Official current API/SDK documentation at implementation time.

The site is **not** a marketing landing page. Hebrew RTL dashboard first, very light cream canvas, teal/emerald/coral accents, compact right sidebar, 4 KPI cards, doughnut and line/coral bar analytics, detailed tables; the exact approved homepage arrangement cannot change. Other page layouts follow the same design tokens and shared shell. Do not import earlier rejected blue/purple design references.

## Required execution
1. Audit repo and connected service privileges without printing credentials. Create a scoped implementation plan and acceptance matrix; no secrets in source control.
2. Confirm original \`design/reference/approved-home.png\` present; if absent, request the source asset or use owner-provided design bundle to add it as **actual binary**, not an SVG substitute; do not invent or claim it is there.
3. Bootstrap production-quality Next.js App Router + TypeScript app within **existing** \`Cost_Managment\` repo. Use Tailwind, shadcn/Radix and a maintained chart/table system after verifying current versions and license. All RTL, responsive, accessible (WCAG 2.2 AA target).
4. Build actual authenticated backend with project/vendor/expense/document schemas, currency conversions, cost allocations, immutable audit, source provenance, estimated-vs-confirmed statuses and migrations. Provide table indexes and idempotent sync workers.
5. Build screens in docs: Home (pixel/visual fidelity from original), Projects, Project Detail, Expenses, Invoices & Documents, Suppliers, Reports, Integrations, Settings; future Revenue/Clients/Payments scaffold behind flags.
6. Implement provider connector interface; activate only proven read-only sources (Vercel, Supabase, Hetzner invoice/Gmail, GitHub, Google Cloud billing API/BigQuery, Claude Pro receipt). Keep other vendors \`UNCONFIGURED\` or \`UNSUPPORTED\` until working and authorized. Never synthesize financial actuals.
7. Gmail expense invoices must be deduplicated and reconciled; store actual originals in private object storage, never public static assets.
8. Define \`PaymentProvider\` and \`InvoiceProvider\` contracts with **Null/test adapters** and tests; providers Grow/SUMIT remain unselected/unpurchased. No live invoices or checkout.
9. CI: formatting, types, lint, unit/integration tests, E2E for permission gates, ledger totals, one connector, FX, invoice attachment security, RTL and responsive quality. Include data classification: DEMO / ACTUAL / ESTIMATED.
10. Create a **new Vercel project** \`d2r-management\` (if unused) under the **existing** Vercel team/plan and connect it to \`yotamfried-ux/Cost_Managment\` \`main\`. No second GitHub repository, no new paid plan. Set server secrets in Vercel environment manager only.
11. Deploy Preview to Vercel; verify screens, backend authorization, basic flows, source evidence and browser screenshots; compare each page's global shell directly against approved screenshot. Fix all blockers.
12. Before Production, obtain owner's acceptance of preview and any cost/security/privacy changes. Deploy to Production once authorized.
13. Associate custom domain \`finance.d2ryf.com\` through Vercel and retrieve **the exact DNS value**; owner will update Namecheap afterwards unless approved secure DNS integration is available. Tell owner \`CNAME / finance / <actual Vercel target> / Automatic\`; add TXT only when Vercel asks, never blindly substitute cname.vercel-dns.com. Do not change nameservers/MX/root domain.
14. Verify HTTPS and private sign-in after DNS resolves. Keep public unauthenticated entry non-sensitive; do not expose cost data, receipts or API credentials.
15. Produce a final evidence bundle: repo+commit+PR links; Vercel project, preview and production URLs; test outputs and E2E evidence; screenshots vs approved; live connector status; known gaps; vendor API billing source summary; estimate of **new** project running cost.

## Important constraints
- **Do not auto-merge code without explicit permission**; owner approved merging the planning/design documentation, not code.
- Prefer reuse of Hetzner/n8n/Postgres or existing Supabase only if access and data isolation are appropriate. Never mutate SportReel/Tori production DB structures.
- Ask for approval before any new paid resource, payment event, domain/DNS changes, destructive changes, or reading unnecessary personal data.
- No secrets in client or repository; implement MFA where supported, server authorization, signed document URLs, error handling, backup + restore.
- Don't mark anything LIVE/VERIFIED until source, time, amount, environment and independent test support it.
- **Never claim the site is running** merely because a design or specification exists.

Complete the build end-to-end after the user initiates this execution and approves gated steps, rather than stopping after sketches or planning.