# Design inventory / asset provenance

The owner supplied a screenshot of the **approved homepage**, title "ניהול העסק", which is the single binding visual reference. It was uploaded in the ChatGPT conversation on 21 Nov 2026; the original reference image is not reproduced from memory. Target binary path:

\`design/reference/approved-home.png\` (**pending binary transfer, do not assert it is present**).

Other screenshots created after owner's request showed following subpages; they are **explorations**, not independently approved:
- Projects
- Expenses
- Invoices
- Suppliers
- Reports
- Settings
- Additional project / integration concepts

Use these as proposed extensions of the approved look, not replacements for the approved homepage. Store original raster sources in \`design/explorations/*.png\` when a verified binary upload path is available. The initial README/specs were written through GitHub connector; **this environment cannot transfer local PNG bytes through that text-only GitHub write path**.

The output layout/design recipe, exact chart / table relationships and color/token selections are captured in \`docs/DESIGN-SYSTEM.md\`. Preserve exact original PNG file bytes when eventually adding media, not a regenerated screenshot, and flag all figures shown as illustrative.

## Image manifest for binary handoff
| Intended path | Source | Status |
|---|---|---|
| \`design/reference/approved-home.png\` | User screenshot \`1000294100.png\` | PENDING_UPLOAD |
| \`design/explorations/projects.png\` | Projects screen generated in conversation | PENDING_UPLOAD |
| \`design/explorations/expenses.png\` | Expenses screen generated in conversation | PENDING_UPLOAD |
| \`design/explorations/invoices.png\` | Invoice screen generated in conversation | PENDING_UPLOAD |
| \`design/explorations/suppliers.png\` | Supplier screen generated in conversation | PENDING_UPLOAD |
| \`design/explorations/reports.png\` | Reports screen generated in conversation | PENDING_UPLOAD |
| \`design/explorations/settings.png\` | Settings screen generated in conversation | PENDING_UPLOAD |

**Do not silently change PENDING_UPLOAD to VERIFIED.** Check GitHub contents before declaring an asset committed.
