# D2R Management — אפיון מוצר, דרישות וקריטריוני קבלה

**סטטוס:** מאושר לתכנון; מימוש טרם החל. **תאריך:** 21.11.2026.  
**Repository:** \`yotamfried-ux/Cost_Managment\` (שם טכני קיים, אין לשנותו).  
**שם המוצר המוצג:** **D2R Management**. **כתובת Production מיועדת:** \`finance.d2ryf.com\` (עדיין אין DNS/פריסת Vercel מאומתים).

## 0. החלטות מחייבות מהשיחות
- העיצוב המאושר היחיד של עמוד הבית הוא **צילום המסך ששלח בעל המוצר ב־21.11.2026**, עם הכותרת **"ניהול העסק"** והמיתוג הקודם \`Cost_Managment\`. אין לעצב אותו מחדש; לשנות רק מיתוג ל־\`D2R Management\` ולממש באמצעות רכיבי UI עקביים.
- העיצוב הוא מקור אמת למראה של **כל שאר המסכים**: רקע שמנת בהיר עם גל עיטורי עדין, כרטיסים לבנים מעוגלים, צללים רכים, צבעי ירוק־טורקיז/מנטה וקורל, טיפוגרפיה עברית קומפקטית ומרווחת, טבלאות צפופות אך קריאות, סרגל ניווט צר **בצד ימין**, שורת בקרה בחלק העליון, RTL מלא.
- **אל תשתמש ב־mockups מוקדמים עם כחול/סגול דומיננטי** — בעל המוצר דחה אותם. יש לסמן את צילום המסך המוסכם בתור \`APPROVED_REFERENCE\`, לא להחליפו בתמונות שיצר AI.
- מדד הצלחה עיצובי: כל מסך חדש נראה כחלק מאותו אתר; לא כאפליקציה אחרת.
- מודול פיננסים ראשון במסך הבית; בהמשך ניהול העסק כולו.
- **המשך פיתוח קודקס ופריסת Production רק אחרי אישור מפורש של בעל המוצר.** מסמך זה הוא handoff להכנת קוד, לא רשות לעבודה ללא האישור.
- תכנון כך שניתן יהיה להוסיף **PaymentProvider** ו־**InvoiceProvider** בהמשך, אחרי החלטה עסקית בין Grow/SUMIT/אחר. לא לבחור/לקנות/להפעיל סליקה כרגע.

## 1. מטרה ומדדי הצלחה
מערכת ניהול עסק פרטית, מתחילה ב־FinOps: מעקב אוטומטי אחרי **עלות אמתית**, שימוש, מנויים, חיובים, קבלות וחשבוניות של פרויקטי פיתוח תוכנה; ובהמשך הכנסות, לקוחות, רווחיות, מוצרים ומסים. מערכת הנתונים חייבת להבחין בבירור בין עלות רשומה/סופית, עלות לפי ספק, אומדן, התחייבות עתידית ומסמך אימות.

משימות ליבה:
1. תוך שניות לדעת כמה כסף יצא החודש, על מה, ולאיזה פרויקט.
2. להבין כל חריגה: ספק ← שימוש ← פרויקט ← רשומת חיוב ← מסמך מקור.
3. לראות מה ייגבה החודש הבא, לזהות מנוי מיותר או כרטיס שנדחה.
4. למצוא מסמכי מקור לדוח מס ולייצא ערכת מסמכים שנתית.
5. למדוד עלות ריצה/סרטון ב־SportReel ועלות למנוי משלם ב־Tori.
6. לאחר הפעלת ספק סליקה: לראות הכנסה, רווח, מנויים, קבלות והחזרי כספים.

## 2. מפת מוצרים
- **SportReel / Video-editing-with-drone:** Gemini API/Google Cloud, GitHub Actions, Vercel/Supabase, Cloudflare R2/Stream (אם פעיל), אחסון/מסירת וידאו. מדדים: מספר הרצות, דקות עיבוד, טוקנים, GB, גלים/סרטונים, סרטונים שנמכרו, עלות לסרטון ונקודת איזון.
- **Tori / Appointment-scheduling-system:** Vercel, Supabase, Resend, Cron, סליקה וחשבוניות בעתיד; MRR, לקוחות משלמים, עלות לשירות, הכנסה נטו.
- **Engineering OS / agents + n8n על Hetzner:** שרת/מחשוב, שירותי מודלי AI, אחסון, CI, מספר משימות/ריצות, הקצאת עלות בין פרויקטים.
- **Portfolio, Automation Shop, Swing Trading ML ויתר מאגרי GitHub:** עצמאיים במודל הפרויקטים, עם דגל \`ACTIVE/ARCHIVED/PLANNED\`; נוכחות בקוד אינה הוכחת תשלום.
- תמיכה במשאבים/מנויים **משותפים** ללא double counting.

## 3. תמונת הוצאות ראשונית (seed, אינה ledger סופי)
| ספק/שירות | מידע ידוע | מעמד |
| --- | --- | --- |
| ChatGPT Plus | ₪70 בחיוב עבר; משתמש מוסר שהמנוי פעיל | אין לייחס אוטומטית חיוב חדש |
| Claude Pro | המשתמש משלם Pro בסיסי; **מחיר אישי לא אומת**, אל תשתמש ב־$20 או ₪69.90 בתור סכום בפועל | \`UNVERIFIED_AMOUNT\` |
| Google AI Pro (מנוי אישי) | ₪18.90 במבצע, לפי מסמך עבר; אפשרות שינוי ל־₪74.90 מ־24.1.2027 | בדוק חידוש ואמת קבלה |
| Gemini API ב־Google Cloud (SportReel) | חיוב נפרד ממנוי Gemini; חסר נתון חשבונאי אמיתי | \`MISSING_BILLING_SOURCE\` |
| Vercel Pro | $20 בחיוב 30.10.2026 | חשבונית עבר |
| Supabase | $35.05 שולם ב־9.11.2026 | חשבונית עבר |
| Hetzner VPS ל־n8n | $10.59 בחשבונית מ־10.11.2026 | חשבונית עבר |
| n8n self-hosted | ללא מנוי n8n | לא לספור שוב עלות Hetzner |
| OpenRouter | $11.80 קרדיטים ב־1.10.2026 | חד־פעמי עד אימות אחרת |
| Namecheap | חידוש דומיין \`d2ryf.com\` ב־11.12.2026; צילום מסך הציג $19.98 | תשלום עתידי, לא מסומן כשולם |
| GitHub Actions | 1,803/2,000 דקות בחבילה לפי התראה מ־20.11.2026 | צריכה, **לא** חיוב |
| Resend, Upstash, Cloudflare, Sentry, OpenAI API, שירותי מידע למניות | מופיעים בפרויקטים/חשבונות | לא להוסיף עלות עד אימות |

**אין להציג סכומי הדגמה ממסכי העיצוב כאמיתיים.** מספרים, חשבוניות, הכנסות, לקוחות ומספרי מסמך בתמונות הם illustrations בלבד.

## 4. מפת מסכים, עם ניווט משותף
מסכים בשלב הראשון:
1. **סקירה / ניהול העסק:** העמוד המאושר *בדיוק בסדר הקומפוזיציה שלו*: פס עליון עם בחירת תאריך וחיפוש, פעולה ראשית \`הוספת הוצאה\`, ארבעה KPI (תזרים/הוצאה חודשית נטו, הוצאות מאומתות, עלות משוערת, חיובים קרובים), מימין גרף עוגת הוצאות, משמאל גרף הכנסות/הוצאות, מתחתיהם פרויקטים פעילים וחיובים קרובים, בתחתית טבלת פעולות אחרונות; כרטיס דוח שנתי בתחתית סרגל הצד.
2. **פרויקטים:** כרטיסי SportReel/Tori/Engineering OS/Portfolio/אחרים; עלויות, תקציב, מגמה, סטטוס; דף Drill-down לפרויקט.
3. **הוצאות:** KPI, מגמות/פילוחים, חיפוש, מסננים, טבלת תנועות, סטטוס אימות, קישור למסמך, סיווג ושיוך.
4. **חשבוניות/מסמכים:** PDF/source original, סטטוס OCR/extraction, חשבונית חסרה/כפולה, פרטי ספק, התאמה לתשלום, תיקונים מבוקרים, חבילת יצוא.
5. **ספקים/מנויים:** קטלוג ספקים, חשבונות, חוזים, עלות, תדירות, חידושים, מחיר היסטורי והתראות.
6. **דוחות:** חודשי, שנתי, ספק, פרויקט, קטגוריה, סטיות תקציב, תחזיות, export XLSX/CSV/PDF.
7. **אינטגרציות:** פעיל/חלקי/חסר הרשאה/נכשל, היסטוריית סנכרון, פעולות retry, חיבור ספק.
8. **הגדרות:** פרופיל, סיווגי מס, מטבע, התראות, פרטיות, גיבוי, Audit, הרשאות.
9. **הכנסות, לקוחות, מוצרים ושירותים, עסקאות:** סקלטון/feature-flag עד חיבור Payment/Invoice adapters, לא fake-live.

לכל טבלה: server-side pagination/sort/filter, חיפוש, תצוגת מסמך, תמיכה ב־RTL, export עם הרשאות, states של EMPTY/LOADING/STALE/ERROR/PARTIAL_DATA. בכותרת KPI תמיד label מקור (\`מאומת\`, \`ספק\`, \`אומדן\`, \`התחייבות\`) ותאריך נכון.

## 5. נתונים והגדרות עסקיות
- שמירת transaction amount במטבע המקורי (ISO 4217), סכום ₪ לצפייה עם FX rate/date/source, ולא לדרוס מקור בעת תיקון.
- יש לשמור \`usage_date\`, \`billing_period\`, \`invoice_issue_date\`, \`paid_at\` כזמנים נפרדים, ו־timezone \`Asia/Jerusalem\`.
- פרויקט וספק: רבים־לרבים באמצעות \`cost_allocations\`, סכומי חלוקה חייבים להתאים למקור; עלויות לא משויכות נפרדות.
- לכל אירוע שימוש \`provider_event_id\` ואידמפוטנטיות. מסמכים: \`sha256\`, \`invoice_number\`, \`supplier_id\`, \`archive_object_key\` ו־\`reconciliation_status\`.
- עבודה עם snapshots ו־audit trail: תיקון סיווג לא משנה raw record. כל claim עלות מצביע על מקור.
- סימון \`TAX_REVIEW_REQUIRED\` והבחנה בין expense עסקי, אישי או מעורב; הוצאות 2026 טרום פתיחת העסק אינן מסווגות אוטומטית כהוצאה מוכרת של 2027.
- רשומות \`transactions\`, \`subscriptions\`, \`projects\`, \`providers\`, \`provider_accounts\`, \`usage_events\`, \`cost_events\`, \`invoices\`, \`documents\`, \`reconciliation_matches\`, \`exchange_rates\`, \`cost_allocations\`, \`sync_runs\`, \`notifications\`, \`audit_events\`, \`customers\`, \`sales\`, \`refunds\` ו־\`payment_events\`.
- Feature flags למודולים עתידיים ושמירת DB migrations גרסאיות.

## 6. אבטחה, מדיניות מס ותפעול
- אתר **פרטי**, Sign-in עם MFA כשאפשר, session management ו־authorization בכל route, API ו־download.
- secrets נשמרים ב־vault/env server-side, לעולם לא ב־frontend, ב־Git או בלוגים. העדף API scopes לקריאה בלבד.
- הצפנת מסמכי מקור, signed download עם תוקף קצר, retention לפי מדיניות חוקית שדורשת בחינה מול יועץ מס.
- בישראל אין להפיק עצמאית חשבונית מס שאינה מתאימה למעמד העסק; הפקת מסמכי הכנסה רק דרך \`InvoiceProvider\` מורשה כאשר נבחר.
- webhook signature verification, queue, replay protection, idempotency, audit; backups ו־**restore drill**.
- בדיקות Accessibility: WCAG 2.2 AA יעד, keyboard, screen readers, reduced motion, mobile, RTL.
- לעולם אל תפעיל תוכנית בתשלום חדשה/שינוי DNS קיים/שינוי פרויקט אחר/ייצור חשבונית אמיתית/פעולת סליקה ללא אישור נפרד.

## 7. שלבים וקריטריוני קבלה
**M0 — תכנון וסביבת עבודה:** מימוש מסמך זה ו־\`DESIGN-SYSTEM.md\`; אישור ויזואלי סופי; מיפוי provider scopes ותשתיות. 
**M1 — בסיס עובד:** Auth, migrations, project model, providers, expenses, dashboard בנכונות נתונים, build/test, preview.
**M2 — אינטגרציות:** Gmail import, Vercel, Supabase, Hetzner, GitHub; Google Cloud Billing/BigQuery, Claude receipt, idempotent sync, invoice archive.
**M3 — עלויות עסקיות:** allocations, unit economics, FX, forecasting, alerts, exports, backup/restore.
**M4 — עסק עתידי:** customers/revenue/invoicing/payment plugins כשנבחר ספק ומעמד עסק מאומת.
**M5 — Production:** Vercel project חדש מקושר לריפו הקיים, preview QA, אישור בעל מוצר, DNS מדויק מ־Vercel, HTTPS ותיעוד deployment.

הצלחה רק על סמך CI, בדיקת end-to-end עם נתוני אמת (או fixture מבודד ומסומן), אימות שאין נתון מדומה שנכנס לדוחות אמת, תיעוד פערים וסמכות/הרשאות. אין לטעון \`PRODUCTION READY\` על סמך design mockup.

## 8. קישורים לספריות Engineering-OS
יש לקרוא בפועל לפני מימוש:
- \`AGENTS.md\`, \`capability-registry/ROUTING-MAP.md\`
- \`docs/ui-ux/README.md\`, \`docs/ui-ux/EXPERIENCE-ROUTING.md\`, \`docs/ui-ux/SCREEN-CONTENT-PLAYBOOK.md\`, \`docs/ui-ux/PRODUCT-EXPERIENCE-QUALITY-GATE.md\`
- \`patterns/ui/README.md\`, \`patterns/frontend/README.md\`, \`templates/admin-dashboard/README.md\`
- \`external-skills/ui-ux-pro-max/\` (החליף \`frontend-design\` deprecated), \`docs/product-experience/\`
- \`patterns/billing/README.md\`, \`docs/legal-compliance/APPLICABILITY-AND-ROUTING.md\`
- \`templates/web-application/README.md\`, \`docs/launch-readiness/\`
תעד איזה מסמך נקרא, מה אומץ ולמה, ואילו תלות/סקילים זמינים בפועל; עצם היותו במאגר ידע אינה התקנה.
