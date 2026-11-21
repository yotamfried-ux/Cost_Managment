"use client";

import { useId } from "react";
import { Area, Bar, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { shekels } from "@/lib/finance";
import type { Series } from "@/lib/queries";

const palette = ["#117e76", "#44b7a5", "#a8d8c4", "#f2bb98", "#ee8b79", "#d8c5cf", "#738f91"];

export function Distribution({ rows, units = "money", label }: { rows: Series[]; units?: "money" | "number"; label: string }) {
  const total = rows.reduce((acc, row) => acc + row.total, 0);
  const value = (amount: number) => units === "money" ? shekels(amount) : new Intl.NumberFormat("he-IL").format(amount);
  let position = 0;
  const stops = rows.map((row, index) => {
    const start = position;
    position += row.total / total * 100;
    return `${palette[index % palette.length]} ${start}% ${position}%`;
  });
  return <div className="distribution">
    {total > 0 ? <ul className="chart-legend">{rows.map((row, index) => <li key={row.name}><span className="legend-name">
      <i style={{ background: palette[index % palette.length] }} aria-hidden="true"/>{row.name}</span><bdi>{value(row.total)}</bdi><span>{Math.round(row.total / total * 100)}%</span>
    </li>)}</ul> : <p className="empty">אין נתונים לפילוח.</p>}
    <div className="donut" style={total > 0 ? { background: `conic-gradient(${stops.join(",")})` } : undefined}>
      <div className="donut-inner"><strong><bdi>{total > 0 ? value(total) : "—"}</bdi></strong><span>{label}</span></div>
    </div>
  </div>;
}

export type TrendPoint = { label: string; first: number | null; second: number | null };
export function Trend({ rows, firstLabel, secondLabel, units = "money" }: {
  rows: TrendPoint[]; firstLabel: string; secondLabel: string; units?: "money" | "number";
}) {
  const id = useId().replaceAll(":", "");
  const value = (amount: number) => units === "money" ? shekels(amount) : String(amount);
  const hasData = rows.some(row => row.first !== null || row.second !== null);
  const legend = [{ label: firstLabel, color: "#e67766" }, { label: secondLabel, color: "#117e76" }];
  return <>
    <div className="series-legend">{legend.map(item => <span key={item.label}><i style={{ background: item.color }} aria-hidden="true"/>{item.label}</span>)}</div>
    <div className="chart-wrap" dir="ltr" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%" minWidth={1}>
        <ComposedChart data={rows} margin={{ top: 14, right: 12, bottom: 2, left: 3 }}>
          <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#26a795" stopOpacity={0.24}/><stop offset="100%" stopColor="#26a795" stopOpacity={0.015}/></linearGradient></defs>
          <CartesianGrid vertical={false} stroke="#ebe6e2"/>
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#45505a" }} tickLine={false} axisLine={false} minTickGap={12}/>
          <YAxis tick={{ fontSize: 11, fill: "#45505a" }} tickLine={false} axisLine={false} width={55}
            tickFormatter={(amount: number) => units === "money" ? `₪ ${Intl.NumberFormat("he", { notation: "compact" }).format(amount / 100)}` : String(amount)} />
          <Tooltip formatter={(amount) => value(Number(amount))} contentStyle={{ direction: "rtl", borderRadius: 10 }} />
          <Bar dataKey="first" name={firstLabel} fill="#ee8b79" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          <Area dataKey="second" name={secondLabel} type="linear" stroke="#117e76" strokeWidth={2} dot={{ r: 3, fill: "#117e76" }} fill={`url(#${id})`} isAnimationActive={false}/>
        </ComposedChart>
      </ResponsiveContainer>
      {!hasData && <p className="chart-empty" dir="rtl">אין נתונים לתקופה הנבחרת</p>}
    </div>
    {hasData ? <details className="chart-data"><summary>נתוני הגרף בטבלה</summary><table><thead><tr><th>חודש</th><th>{firstLabel}</th><th>{secondLabel}</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.label}><th scope="row">{row.label}</th><td><bdi>{row.first === null ? "—" : value(row.first)}</bdi></td><td><bdi>{row.second === null ? "—" : value(row.second)}</bdi></td></tr>)}</tbody></table></details> : <p className="visually-hidden">אין נתונים לתקופה הנבחרת</p>}
  </>;
}
