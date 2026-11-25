# D2R Management

מערכת פרטית לניהול הוצאות, מסמכים ו־FinOps בעברית. האפליקציה מבוססת על תמונות העיצוב שסיפק בעל המוצר.

## Local development

Use Node.js 24 and `npm ci`. Run `npm run dev` for the app or `npm run build` for the production build. To use an isolated local ledger, create account credentials, set the variables from `.env.example`, and set `D2R_LOCAL_DATA_DIR` to a private writable absolute path outside the repository. This mode is available only locally. Vercel uses GitHub-backed storage.

Run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`. For authenticated browser tests, set up a fresh disposable fixture with `GITHUB_ENV=/tmp/d2r-test-env npx tsx tests/local-fixture.ts`. Read those variables from the generated file into the test runner without printing them, then run `npm run e2e`. The fixture has owner and viewer accounts and keeps test data out of the Git repository. GitHub CI publishes browser reports and desktop and mobile evidence.

## Data and permissions

- The ledger and PDF originals are encrypted by the server before writing to the private repository. Only the separate data branches carry finance data, with independent keys for Preview and Production.
- A finance session requires a password and TOTP. The server validates the current configured role and serves downloads only to authenticated users. Viewer accounts cannot write.
- Manual expenses start as estimate or missing. Reconciliation with an original PDF verifies a matching expense. API results remain provider data. FX conversion uses a dated rate with a recorded source. Missing conversion rates are visible and never silently mixed into ILS totals.
- The payment and accounting-document provider contracts remain disabled. No live checkout, refund, or official invoice issuance is available.

See [operations, configuration, and remaining scope](docs/OPERATIONS.md).
