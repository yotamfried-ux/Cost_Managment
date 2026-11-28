import { Bot, CalendarClock, CircleCheck, ClipboardCheck, ExternalLink, FileText, TriangleAlert } from "lucide-react";
import { reviewPosts } from "@/app/approval-actions";
import { normalizeCrm, publicationLabels, type CrmData, type Publication } from "@/lib/business";
import { agentLabel, cadenceLabel, ownerAttention } from "@/lib/owner-attention";
import { AckButton } from "./ack-button";
import { currentTime, israelDay, lateMs, stuckMs } from "@/lib/publishing";
import type { Role } from "@/lib/repository";
import { PendingButton } from "./pending-button";
import { Blank, Chip, DataTable, displayDate, Metrics, Panel } from "./dashboard";

const zone = "Asia/Jerusalem";
const dayTitle = (day: string) => new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(day + "T12:00:00Z"));
const timeOf = (iso: string) => new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: zone }).format(new Date(iso));
const stamp = (iso: string) => `${displayDate(israelDay(iso))} · ${timeOf(iso)}`;
const platformNames = { instagram: "Instagram", facebook: "Facebook" } as const;
const crmOf = (data: { crm?: CrmData }) => normalizeCrm(data.crm ? { ...data.crm } : undefined);
const tone = (status: Publication["status"]) => status === "published" ? "good" : status === "failed" || status === "expired" || status === "rejected" ? "bad" : status === "pending" ? "pending" : "neutral";

/** A short Hebrew reason when something needs the owner's attention, otherwise null. */
function attention(post: Publication, now: number) {
  if (post.status === "failed") return post.result || "הפרסום נכשל";
  if (post.status === "publishing" && post.claimedAt && now - Date.parse(post.claimedAt) > stuckMs) return "הפרסום תקוע. בדקו ב־n8n לפני שמנסים שוב, כדי לא לפרסם פעמיים.";
  if (post.status === "approved" && now - Date.parse(post.publishAt) > lateMs) return "עבר מועד הפרסום והמפרסם עוד לא לקח את הפוסט. בדקו שהזרימה ב־n8n פעילה.";
  if (post.status === "pending" && Date.parse(post.publishAt) <= now) return "מועד הפרסום עבר, אי אפשר לאשר. הסוכן צריך להציע מועד חדש.";
  return null;
}

function ReviewForm({ keys, decision, month, children, primary = false }: { keys: string[]; decision: "approve" | "reject" | "cancel"; month: string; children: React.ReactNode; primary?: boolean }) {
  return <form action={reviewPosts}>
    <input type="hidden" name="month" value={month}/><input type="hidden" name="decision" value={decision}/>
    {keys.map(key => <input key={key} type="hidden" name="key" value={key}/>)}
    <PendingButton className={`button${primary ? " primary" : ""}`}>{children}</PendingButton>
  </form>;
}

/** Instagram shows roughly the first 125 characters of a caption before "more". */
const cutAt = 125;
const owner = "החשבון שלך";

/** Image posts must render as images; a video element cannot play a PNG/JPEG. */
export const isImage = (fileName: string) => /\.(png|jpe?g|webp)$/i.test(fileName);

function Preview({ post, network }: { post: Publication; network: "instagram" | "facebook" }) {
  const caption = network === "instagram" ? post.captionIg : post.captionFb;
  const cut = network === "instagram" && caption.length > cutAt;
  const label = network === "instagram" ? "Instagram" : "Facebook";
  return <figure className={`preview ${network}`}>
    <figcaption>{label}</figcaption>
    <div className="phone">
      <div className="phone-screen">
        {isImage(post.fileName)
          ? // eslint-disable-next-line @next/next/no-img-element
            <img className="phone-image" src={post.fileUrl} alt={`תמונת הפוסט: ${post.hook || post.fileName}`}/>
          : <video src={post.fileUrl} poster={post.posterUrl ?? undefined} controls muted playsInline loop preload="metadata" aria-label={`סרטון הפוסט: ${post.hook || post.fileName}`}/>}
        {network === "instagram" && <div className="reel-overlay" dir="auto">
          <strong>{owner}</strong>
          <span className="reel-caption">{cut ? caption.slice(0, cutAt).trimEnd() : caption}{cut && <span className="reel-more"> … עוד</span>}</span>
        </div>}
      </div>
    </div>
    {network === "facebook" && <p className="fb-text" dir="auto"><strong>{owner}</strong><br/>{caption}</p>}
    <p className="range-label">{network === "instagram" ? `תצוגה מקורבת. ${cut ? `הכיתוב נחתך אחרי כ־${cutAt} תווים, והשאר מופיע אחרי "עוד".` : "הכיתוב קצר ונראה במלואו."}` : "תצוגה מקורבת של פוסט וידאו בעמוד."}</p>
  </figure>;
}

function PostCard({ post, owner: isOwner, month, now }: { post: Publication; owner: boolean; month: string; now: number }) {
  const issue = attention(post, now);
  return <article className="pub-card" aria-label={`פוסט ${post.hook || post.key}`}>
    <header className="pub-head">
      <strong><bdi>{timeOf(post.publishAt)}</bdi>{post.slot && <> · חלון {post.slot}</>}</strong>
      <span className="pub-tags">
        {post.platforms.map(platform => <Chip key={platform}>{platformNames[platform]}</Chip>)}
        {post.product && <Chip>{post.product}</Chip>}
        <Chip tone={tone(post.status)}>{publicationLabels[post.status]}</Chip>
      </span>
    </header>
    {post.hook && <p className="pub-hook">{post.hook}</p>}
    <div className="pub-previews">{post.platforms.map(platform => <Preview key={platform} post={post} network={platform}/>)}</div>
    <details className="pub-raw"><summary>הטקסט המלא ופרטי הקובץ</summary>
      {post.platforms.includes("instagram") && <><h3>טקסט ל־Instagram ({post.captionIg.length} תווים)</h3><p className="caption-text" dir="auto">{post.captionIg}</p></>}
      {post.platforms.includes("facebook") && post.captionFb !== post.captionIg && <><h3>טקסט ל־Facebook ({post.captionFb.length} תווים)</h3><p className="caption-text" dir="auto">{post.captionFb}</p></>}
      <p className="pub-file"><a className="text-link" href={post.fileUrl} rel="noopener noreferrer" target="_blank"><ExternalLink size={14} aria-hidden="true"/> {post.fileName}</a>{post.note && <> · {post.note}</>}</p>
    </details>
    {issue && <p className="notice" role="alert"><TriangleAlert size={15} aria-hidden="true"/> {issue}</p>}
    {post.status === "pending" && isOwner && Date.parse(post.publishAt) > now && <div className="pub-actions">
      <ReviewForm keys={[post.key]} decision="approve" month={month} primary>אישור הפוסט</ReviewForm>
      <ReviewForm keys={[post.key]} decision="reject" month={month}>דחייה</ReviewForm>
    </div>}
    {post.status === "approved" && isOwner && Date.parse(post.publishAt) > now && <div className="pub-actions">
      <ReviewForm keys={[post.key]} decision="cancel" month={month}>ביטול האישור (לא יפורסם)</ReviewForm>
    </div>}
    {post.approvedAt && post.approvedBy && <p className="range-label">אושר על ידי {post.approvedBy} · {stamp(post.approvedAt)}</p>}
  </article>;
}

export function ApprovalsView({ data, role, month, search }: { data: { crm?: CrmData }; role: Role; month: string; search: { saved?: string; done?: string; skipped?: string; error?: string } }) {
  const crm = crmOf(data);
  const owner = role === "owner";
  const nowMs = currentTime();
  const open = crm.publications.filter(row => ["pending", "approved", "publishing"].includes(row.status));
  const days = [...new Set(open.map(row => israelDay(row.publishAt)))].sort();
  const history = crm.publications.filter(row => !open.includes(row)).sort((a, b) => b.publishAt.localeCompare(a.publishAt)).slice(0, 40);
  const pending = open.filter(row => row.status === "pending").length;
  const upcoming = open.filter(row => row.status === "approved").length;
  const published = crm.publications.filter(row => row.status === "published").length;
  const needs = crm.publications.filter(row => attention(row, nowMs) !== null).length;
  return <>
    {search.saved && <p className="notice success" role="status">אושרו או נדחו {search.done ?? "0"} פוסטים{Number(search.skipped) > 0 ? `, ${search.skipped} לא טופלו כי כבר אינם ממתינים` : ""}.</p>}
    {search.error && <p className="notice" role="alert">{search.error === "permission" ? "רק בעלי המערכת יכולים לאשר פוסטים." : search.error === "validation" ? "הבקשה לא תקינה." : "הפוסט לא אושר: הוא כבר לא ממתין, מועדו עבר או שהתוכן השתנה. רעננו את העמוד ובדקו."}</p>}
    <Metrics metrics={[
      { label: "ממתינים לאישור", value: pending, detail: "דורשים החלטה שלכם", icon: ClipboardCheck, tone: pending ? "coral" : undefined },
      { label: "מאושרים וממתינים לפרסום", value: upcoming, detail: "יפורסמו בחלון שנקבע", icon: CalendarClock },
      { label: "פורסמו", value: published, detail: "30 הימים האחרונים", icon: CircleCheck },
      { label: "דורשים טיפול", value: needs, detail: "נכשלו, תקועים או באיחור", icon: TriangleAlert, tone: needs ? "coral" : undefined },
    ]}/>
    {!owner && <p className="notice" role="status">אפשר לצפות בתור, אבל אישור ודחייה זמינים לבעלי המערכת בלבד.</p>}
    {days.length ? days.map(day => {
      const posts = open.filter(row => israelDay(row.publishAt) === day).sort((a, b) => a.publishAt.localeCompare(b.publishAt));
      const waiting = posts.filter(row => row.status === "pending" && Date.parse(row.publishAt) > nowMs);
      return <Panel key={day} title={`${dayTitle(day)} · ${posts.length} פוסטים`} action={owner && waiting.length > 0
        ? <ReviewForm keys={waiting.map(row => row.key)} decision="approve" month={month} primary>אישור {waiting.length === posts.length ? "כל הפוסטים של היום" : `${waiting.length} פוסטים ממתינים`}</ReviewForm> : undefined}>
        <div className="pub-day">{posts.map(post => <PostCard key={post.key} post={post} owner={owner} month={month} now={nowMs}/>)}</div>
      </Panel>;
    }) : <Panel title="תור הפרסום"><Blank>אין פוסטים בתור. סוכן השיווק מכין את שלושת הפוסטים של מחר כל יום, ומציג אותם כאן לאישור.</Blank></Panel>}
    <Panel title="היסטוריה">
      {history.length ? <DataTable headings={["מועד", "חלון", "רשת", "פתיח", "סטטוס", "הערה"]}>{history.map(row => <tr key={row.id}>
        <td>{stamp(row.publishAt)}</td><td>{row.slot || "—"}</td><td>{row.platforms.map(platform => platformNames[platform]).join(", ")}</td><td>{row.hook || row.key}</td>
        <td><Chip tone={tone(row.status)}>{publicationLabels[row.status]}</Chip></td><td>{row.result || "—"}</td>
      </tr>)}</DataTable> : <Blank>עוד לא פורסם דבר דרך התור.</Blank>}
    </Panel>
  </>;
}

export function AgentsView({ data }: { data: { crm?: CrmData } }) {
  const crm = crmOf(data);
  const last = new Map<string, (typeof crm.runs)[number]>();
  for (const run of [...crm.runs].sort((a, b) => a.at.localeCompare(b.at))) last.set(run.agent ?? "", run);
  const statusLabels = { proposed: "ממתין להפעלה", active: "פעיל", paused: "מושהה" } as const;
  const waiting = crm.publications.filter(row => row.status === "pending").length;
  const active = crm.agents.filter(row => row.status === "active").length;
  const recent = [...crm.runs].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);
  const names = new Map(crm.agents.map(row => [row.key, agentLabel(row.key, row.name, row.job).name]));
  const idle = crm.agents.filter(row => row.status === "proposed").length;
  return <>
    <Metrics metrics={[
      { label: "סוכנים פעילים", value: active, detail: idle ? `${idle} ממתינים להפעלה שלך` : `מתוך ${crm.agents.length} שהוגדרו`, icon: Bot },
      { label: "ריצות שדווחו", value: crm.runs.length, detail: "100 האחרונות", icon: CircleCheck },
      { label: "פוסטים לאישור", value: waiting, detail: "בעמוד האישורים", icon: ClipboardCheck, tone: waiting ? "coral" : undefined },
    ]}/>
    <Panel title="הסוכנים">
      {crm.agents.length ? <DataTable headings={["סוכן", "תפקיד", "תדירות", "סטטוס", "ריצה אחרונה", "מה נעשה"]}>{crm.agents.map(agent => {
        const run = last.get(agent.key);
        const label = agentLabel(agent.key, agent.name, agent.job);
        return <tr key={agent.id}>
          <td>{label.name}</td><td>{label.job || "—"}</td><td>{cadenceLabel(agent.cadence)}</td>
          <td><Chip tone={agent.status === "active" ? "good" : agent.status === "paused" ? "bad" : "pending"}>{statusLabels[agent.status]}</Chip></td>
          <td>{run ? stamp(run.at) : agent.status === "active" ? "עוד לא רץ" : "לא הופעל"}</td><td>{run?.summary ?? "—"}</td>
        </tr>;
      })}</DataTable> : <Blank>הסוכנים עוד לא שלחו את רשימתם. הם מדווחים כאן בסוף כל ריצה.</Blank>}
      <p className="next-step">פעיל: רץ לבד לפי התזמון שלו. ממתין להפעלה: הוגדר אבל עדיין לא נקבע לו תזמון, וזה קורה רק באישור שלך. עוד לא רץ: הסוכן פעיל וההרצה הראשונה שלו טרם התקיימה.</p>
    </Panel>
    <Panel title="פעילות אחרונה">
      {recent.length ? <DataTable headings={["מועד", "סוכן", "ריצה", "סיכום"]}>{recent.map(run => <tr key={run.id}>
        <td>{stamp(run.at)}</td><td>{names.get(run.agent ?? "") ?? (run.agent || "—")}</td><td>{run.routine}</td><td>{run.summary}</td>
      </tr>)}</DataTable> : <Blank>אין ריצות מדווחות עדיין. נתונים נקלטים מהסוכנים דרך הקליטה המאובטחת ולא נוצרים אוטומטית.</Blank>}
    </Panel>
  </>;
}

export function OutputsView({ data, role, month }: { data: { crm?: CrmData }; role: Role; month: string }) {
  const crm = crmOf(data);
  const names = new Map(crm.agents.map(row => [row.key, row.name]));
  const ordered = [...crm.digests].sort((a, b) => b.at.localeCompare(a.at));
  const deciding = ordered.filter(row => row.decision).slice(0, 5);
  const byAgent = [...new Set(ordered.map(row => row.agent))];
  const openDecision = ownerAttention({ crm, unallocatedMinor: null, upcomingCharges: 0, nowMs: currentTime() }).find(item => item.id === "decide");
  return <>
    <Metrics metrics={[
      { label: "סיכומים", value: ordered.length, detail: "60 האחרונים", icon: FileText },
      { label: "דורשים החלטה", value: ordered.filter(row => row.decision).length, detail: "הסוכן שואל אתכם משהו", icon: TriangleAlert, tone: ordered.some(row => row.decision) ? "coral" : undefined },
      { label: "סוכנים עם תוצרים", value: byAgent.length, detail: "מתוך כל הסוכנים", icon: Bot },
    ]}/>
    {deciding.length > 0 && <Panel title="מה אני צריך ממך" action={role === "owner" && openDecision ? <AckButton id="decide" fingerprint={openDecision.fingerprint} month={month} back="outputs">טופל, אפשר להסיר את ההתראה</AckButton> : undefined}>
      <ul className="decision-list">{deciding.map(row => <li key={row.id}><strong>{names.get(row.agent) ?? row.agent}</strong> · {row.title}<br/>{row.decision}</li>)}</ul>
    </Panel>}
    {byAgent.length ? byAgent.map(agent => <Panel key={agent} title={names.get(agent) ?? (agent || "ללא סוכן")}>
      <div className="digest-list">{ordered.filter(row => row.agent === agent).slice(0, 5).map(row => <article key={row.id} className="digest" aria-label={row.title}>
        <header><h3>{row.title}</h3><span className="range-label">{stamp(row.at)}</span></header>
        <p>{row.summary}</p>
        {row.decision && <p className="notice" role="note"><strong>מה אני צריך ממך:</strong> {row.decision}</p>}
        {row.items.length > 0 && <ul className="digest-items">{row.items.map((item, index) => <li key={index}>
          <span><strong>{item.title}</strong>{item.tag && <> <Chip>{item.tag}</Chip></>}</span>
          {item.detail && <span className="digest-detail">{item.detail}</span>}
          {item.link && <a className="text-link" href={item.link} rel="noopener noreferrer" target="_blank">פתיחה</a>}
        </li>)}</ul>}
      </article>)}</div>
    </Panel>) : <Panel title="תוצרי סוכנים"><Blank>עוד אין סיכומים. כל סוכן ישלח כאן בסוף ריצה סיכום קצר: מה מצא, מה מומלץ ומה דורש את ההחלטה שלכם.</Blank></Panel>}
  </>;
}
