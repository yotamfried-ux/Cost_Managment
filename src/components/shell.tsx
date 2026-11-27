"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { House, Layers3, CreditCard, FileText, UsersRound, ChartNoAxesColumnIncreasing, Settings, Plug, ArrowLeft, Bell, CalendarDays, Search, ChevronDown, Menu, Target, UserRoundCheck, Megaphone, ClipboardCheck, Bot, Lightbulb } from "lucide-react";
import { Brand } from "./brand";
import { signOut } from "@/app/auth-actions";
import { monthTitle, resolveMonth } from "@/lib/finance";

type NavLink = readonly [string, string, typeof House];
const groups: { title: string; links: NavLink[] }[] = [
  { title: "", links: [["/", "סקירה", House]] },
  { title: "כסף", links: [["/projects","פרויקטים",Layers3], ["/expenses","הוצאות",CreditCard], ["/invoices","חשבוניות",FileText], ["/suppliers","ספקים",UsersRound], ["/reports","דוחות",ChartNoAxesColumnIncreasing]] },
  { title: "מכירות ושיווק", links: [["/leads","לידים",Target], ["/customers","לקוחות",UserRoundCheck], ["/marketing","שיווק",Megaphone]] },
  { title: "סוכנים", links: [["/approvals","אישורים",ClipboardCheck], ["/outputs","תוצרי סוכנים",Lightbulb], ["/agents","סוכנים",Bot]] },
  { title: "מערכת", links: [["/integrations","אינטגרציות",Plug], ["/settings","הגדרות",Settings]] },
];
const links = groups.flatMap(group => group.links);
const primary = new Set(["/", "/projects", "/expenses", "/approvals", "/outputs"]);

export function Shell({ initials, notifications, badges = {}, children }: { initials: string; notifications: number; badges?: Record<string, number>; children: React.ReactNode }) {
  const path = usePathname();
  const params = useSearchParams();
  const month = resolveMonth(params.get("month") ?? undefined);
  return <div className="shell">
    <a href="#main-content" className="skip-link">דילוג לתוכן</a>
    <aside className="sidebar">
      <Link className="sidebar-logo" href={`/?month=${month}`} aria-label="D2R Management, סקירה"><Brand /></Link>
      <nav aria-label="ניווט ראשי">{groups.map(group => <div className="nav-group" key={group.title || "main"}>
        {group.title && <p className="nav-heading">{group.title}</p>}
        {group.links.map(([url,label,Icon]) => {
          const badge = badges[url] ?? 0;
          return <Link key={url} href={`${url}?month=${month}`} className="nav-link" data-primary={primary.has(url) ? "" : undefined} aria-current={(url === "/" ? path === "/" : path.startsWith(url)) ? "page" : undefined}>
            <Icon size={19} aria-hidden="true" /><span>{label}</span>{badge > 0 && <b className="nav-badge" aria-label={`${badge} ממתינים`}>{badge}</b>}
          </Link>;
        })}</div>)}</nav>
      <section className="annual">
        <span className="annual-icon"><ChartNoAxesColumnIncreasing size={18} aria-hidden="true"/></span>
        <strong>סקירה שנתית {month.slice(0, 4)}</strong>
        <p>הוצאות לפי מקור, ספק ופרויקט</p>
        <Link className="button" href={`/reports?month=${month}&period=annual`}>צפה בדוח <ArrowLeft size={14} aria-hidden="true"/></Link>
      </section>
    </aside>
    <div className="workspace">
      <header className="topbar">
        <details className="mobile-menu disclosure"><summary className="button icon-button" aria-label="תפריט"><Menu size={20}/></summary>
          <nav className="popover" aria-label="תפריט משני">{links.map(([url,label,Icon]) => <Link className="nav-link" key={url} href={`${url}?month=${month}`}><Icon size={17} aria-hidden="true"/>{label}{(badges[url] ?? 0) > 0 && <b className="nav-badge">{badges[url]}</b>}</Link>)}</nav>
        </details>
        <form action="/expenses" className="top-search">
          <input type="hidden" name="month" value={month} />
          <Search size={17} aria-hidden="true" /><input type="search" name="q" aria-label="חיפוש בהוצאות" placeholder="חיפוש בהוצאות..." defaultValue={params.get("q") ?? ""} />
          <button type="submit" className="visually-hidden">חיפוש</button>
        </form>
        <MonthPicker key={month} month={month} path={path}/>
        <Link className="icon-button notification" aria-label={`התראות, ${notifications} חדשות`} href={`/settings?month=${month}#notifications`}><Bell size={19}/>{notifications > 0 && <i/>}</Link>
        <details className="disclosure user-menu"><summary className="user-control" aria-label="תפריט משתמש"><span>{initials}</span><ChevronDown size={13}/></summary>
          <div className="popover"><form action={signOut}><button className="button">יציאה</button></form></div>
        </details>
      </header>
      <main id="main-content" tabIndex={-1}>{children}</main>
    </div>
  </div>;
}

function MonthPicker({ path, month }: { path: string; month: string }) {
  const [chosen, setChosen] = useState(month);
  return <form action={path} className="month-form">
    <label className="month-picker">
      <CalendarDays size={17} aria-hidden="true"/><span aria-hidden="true">{monthTitle(resolveMonth(chosen))}</span>
      <input aria-label="בחירת חודש" name="month" type="month" value={chosen} onChange={event => setChosen(event.target.value)} required />
    </label>
    <button className="month-submit" type="submit" aria-label="הצג חודש"><ChevronDown size={15} aria-hidden="true" /></button>
  </form>;
}
