# D2R Management

מערכת פרטית לניהול הוצאות, מסמכים ו־FinOps בעברית.

## Local development

Use Node.js 24, Docker, and `npm ci`. Copy `.env.example` to `.env.local`, start a dedicated local Supabase stack with `npx supabase@3.2.0 start`, and set its API URL and publishable key. The migrations run when the stack starts. Set up invited accounts only and require each account to enroll its TOTP authenticator. An operator creates the organization and its first `owner` membership in that isolated database. Finance rows and private document links require both membership and MFA.

Run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`. For authenticated browser tests on a fresh local database, run `GITHUB_ENV=/tmp/d2r-test-env node tests/local-fixture.mjs`, then load that file into the test shell before running `npm run e2e`. Use that fixture and its test accounts only on a disposable local stack. Playwright's HTML report is written to `playwright-report/`. GitHub CI uses its own disposable database and publishes tested desktop/mobile captures.

## Data boundaries

- Estimate or missing is the starting state for hand-entered expenses. Reconciliation with an original PDF changes a matching expense to verified. Daily API totals are provider data. Counts and totals exclude unresolved FX separately from source classification.
- Amounts retain original ISO currency and minor units. Add a dated, sourced exchange rate from the expenses screen where needed. Totals in ILS do not silently mix currencies.
- PDF files are stored by their SHA-256 key in a private bucket. Downloads require a workspace session and generate short-lived links.
- The approved visual references are the image attachments supplied by the product owner. Their illustrative figures do not seed finance tables.
- Scheduled connections are off until the isolated deployment is configured. Store credentials with Vercel's environment manager. Never reuse production finance or receipt credentials in Preview.
- The payment and invoice plugins are disabled. There is no live checkout, refund, or official invoice issuance.

See [operations and connector status](docs/OPERATIONS.md).
