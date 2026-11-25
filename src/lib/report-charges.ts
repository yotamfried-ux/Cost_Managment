import { roundParts } from "./allocation";
import { monthlyManualCharges } from "./monthly-charges";
import type { Charge, WorkspaceData } from "./repository";

export function reportCharges(data: WorkspaceData, month: string, end: string): Charge[] {
  const subscriptions = monthlyManualCharges(data, month, end);
  const manualVercel = new Set(subscriptions.filter(row => row.description.toLowerCase() === "vercel pro")
    .map(row => `${row.supplier_id}:${row.recorded_on.slice(0, 7)}`));
  const projectIds = new Map(data.projects.flatMap(project => (project.vercelProjectIds ?? []).map(id => [id, project.id] as const)));
  return [...data.charges.flatMap(charge => {
    const details = charge.vercelBreakdown;
    if (charge.source !== "vercel" || charge.evidence !== "provider" || charge.amount_minor === null || !details) return [charge];
    const skipPlatform = manualVercel.has(`${charge.supplier_id}:${charge.recorded_on.slice(0, 7)}`);
    const platform = details.platformMinor;
    const tagged = details.projects.filter(part => projectIds.has(part.id));
    if (!tagged.length && (!platform || !skipPlatform)) return [charge];
    const remaining = charge.amount_minor - platform - tagged.reduce((sum, part) => sum + part.minor, 0);
    const amounts = [platform, remaining, ...tagged.map(part => part.minor)];
    const quote = Number(charge.exchange_rate?.quote);
    const converted = charge.amount_ils_minor !== null && quote > 0
      ? roundParts(amounts.map(amount => amount * quote), charge.amount_ils_minor) : null;
    const display = (index: number, project: string | null, description: string): Charge[] => {
      if (!amounts[index] && !converted?.[index]) return [];
      return [{ ...charge, id: `${charge.id}:${index}`, description, amount_minor: amounts[index],
        amount_ils_minor: converted?.[index] ?? null, project_id: project,
        allocations: charge.allocations ?? (charge.project_id ? [{ projectId: charge.project_id, basisPoints: 10_000 }] : undefined),
      }];
    };
    return [
      ...(skipPlatform ? [] : display(0, null, "Vercel Pro · נתוני ספק")),
      ...display(1, null, charge.description),
      ...tagged.flatMap((part, index) => display(index + 2, projectIds.get(part.id)!, "Vercel · שימוש בפרויקט")),
    ];
  }), ...subscriptions];
}
