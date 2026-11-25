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

    return [...totals].map(([day, amounts]): ProviderCost => {
      const next = new Date(Date.parse(day + "T00:00:00Z") + 86_400_000).toISOString().slice(0, 10);
      const projectParts = [...amounts.projects].sort(([a], [b]) => a.localeCompare(b));
      const values = [amounts.platform, amounts.shared, ...projectParts.map(([, amount]) => amount)].map(amount => amount * 100);
      const sum = values.reduce((total, amount) => total + amount, 0);
      const minor = Math.sign(sum) * Math.round(Math.abs(sum));
      const parts = roundParts(values, minor);
      return {
        key: `${day}:${next}:USD`, start: day, end: next, label: "Vercel team billing · FOCUS",
        currency: "USD", minor,
        vercelBreakdown: { platformMinor: parts[0], projects: projectParts.flatMap(([id], index) => parts[index + 2] ? [{ id, minor: parts[index + 2] }] : []) },
      };
    });
  } };
}
