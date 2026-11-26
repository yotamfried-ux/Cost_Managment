import { z } from "zod";
import type { CostConnector, ProviderCost } from "./connectors";
import { roundParts } from "./allocation";

const focusRow = z.object({
  BilledCost: z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/)]).transform(Number).pipe(z.number().finite()),
  BillingCurrency: z.literal("USD"),
  ChargePeriodEnd: z.iso.datetime({ offset: true }),
  SubAccountId: z.string(),
  ServiceName: z.string().optional(),
  ChargeCategory: z.string().optional(),
  Tags: z.object({ ProjectId: z.string().optional() }).nullish(),
});

export function vercelConnector(token: string): CostConnector {
  return { provider: "vercel", async syncCosts({ start, end, account }) {
    if (!/^team_[A-Za-z0-9]+$/.test(account)) throw new Error("vendor_data");
    const url = new URL("https://api.vercel.com/v1/billing/charges");
    url.search = new URLSearchParams({ from: start + "T00:00:00Z", to: end + "T00:00:00Z", teamId: account }).toString();
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/jsonl" },
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(22000),
    });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "permission" : "vendor_request");
    if (!response.body || !response.headers.get("content-type")?.includes("jsonl")) throw new Error("vendor_data");

    const totals = new Map<string, { platform: number; shared: number; projects: Map<string, number> }>();
    const add = (line: string) => {
      if (!line.trim()) return;
      const row = focusRow.parse(JSON.parse(line));
      if (row.SubAccountId !== account) throw new Error("vendor_data");
      const partitionDay = new Date(row.ChargePeriodEnd).toISOString().slice(0, 10);
      if (partitionDay < start || partitionDay >= end) throw new Error("vendor_data");
      const day = totals.get(partitionDay) ?? { platform: 0, shared: 0, projects: new Map<string, number>() };
      const id = row.Tags?.ProjectId;
      if (id && /^prj_[A-Za-z0-9]{10,60}$/.test(id)) day.projects.set(id, (day.projects.get(id) ?? 0) + row.BilledCost);
      else if (row.ServiceName === "Pro" && row.ChargeCategory === "Purchase") day.platform += row.BilledCost;
      else day.shared += row.BilledCost;
      totals.set(partitionDay, day);
    };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 48 * 1024 * 1024) throw new Error("vendor_data");
        const lines = (pending + decoder.decode(value, { stream: true })).split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) add(line);
      }
      add(pending + decoder.decode());
    } finally {
      await reader.cancel();
    }

    const months = new Map<string, string[]>();
    for (const day of [...totals.keys()].sort()) {
      const month = day.slice(0, 7);
      const days = months.get(month) ?? [];
      days.push(day);
      months.set(month, days);
    }

    return [...months.values()].flatMap(days => {
      const amounts = days.map(day => totals.get(day)!);
      const projects = [...new Set(amounts.flatMap(row => [...row.projects.keys()]))].sort();
      const columns = [
        amounts.map(row => row.platform * 100),
        amounts.map(row => row.shared * 100),
        ...projects.map(id => amounts.map(row => (row.projects.get(id) ?? 0) * 100)),
      ];
      const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
      const perMonth = columns.map(sum);
      const monthAmount = sum(perMonth);
      const rounded = roundParts(perMonth, Math.sign(monthAmount) * Math.round(Math.abs(monthAmount)));
      const roundedColumns = columns.map((column, index) => roundParts(column, rounded[index]));
      return days.map((day, dayIndex): ProviderCost => {
        const next = new Date(Date.parse(day + "T00:00:00Z") + 86_400_000).toISOString().slice(0, 10);
        const parts = roundedColumns.map(column => column[dayIndex]);
        return {
          key: `${day}:${next}:USD`, start: day, end: next, label: "Vercel team billing · FOCUS",
          currency: "USD", minor: sum(parts),
          vercelBreakdown: { platformMinor: parts[0], projects: projects.flatMap((id, index) => parts[index + 2] ? [{ id, minor: parts[index + 2] }] : []) },
        };
      });
    });
  } };
}
