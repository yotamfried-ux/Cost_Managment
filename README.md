# D2R Management

**Repository:** \`Cost_Managment\` · **Product UI name:** **D2R Management**.

Private, Hebrew RTL Finance OS for software projects and a future Israeli business. Tracks provider bills, API use, invoices/receipts, recurring charges, project cost allocation and later revenue and customer management.

**Status:** design/specification phase; **no application code built or deployed yet**.

## Documents
- [Product requirements & accepted decisions](docs/PRODUCT-SPEC.md)
- [Approved visual design contract](docs/DESIGN-SYSTEM.md)
- [Connector, payment plugin and deployment architecture](docs/INTEGRATIONS-ARCHITECTURE.md)
- [Codex build & Vercel deployment prompt](docs/CODEX-BUILD-PROMPT.md)
- [Design asset index and provenance](design/README.md)

## Selected visual direction
The owner-approved **"ניהול העסק" screenshot** supplied 21 Nov 2026 is the visual source of truth; do not replace it with unrelated concept art. Subpages must use the same ivory/teal/coral styling, right sidebar, white rounded cards, data density, and chart grammar. Product displayed name is D2R Management even when the screenshot still displays old repo name.

## Planned deployment
Vercel new project linked to this exact existing repository, future hostname \`finance.d2ryf.com\`, DNS target to be retrieved from Vercel **after** project creation. No deployment or production access currently claimed.

## Finance safety
No billing or invoice numbers in generated mockup screens should be mistaken for actual money. Claude Pro amount and Gemini API spend require actual verification. Payment & invoicing provider remains to be selected; modular adapters only.
