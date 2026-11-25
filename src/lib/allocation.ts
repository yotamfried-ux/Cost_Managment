export type Allocation = { projectId: string; basisPoints: number };

export function splitAmount(minor: number, shares: Allocation[]) {
  const assigned = shares.reduce((total, item) => total + item.basisPoints, 0);
  if (assigned > 10_000 || !Number.isSafeInteger(minor)) throw new Error("Invalid allocation");
  const undivided = 10_000 - assigned;
  const parts = [...shares.map(item => ({ id: item.projectId, weight: item.basisPoints })), { id: "", weight: undivided }]
    .map(item => {
      const quotient = BigInt(Math.abs(minor)) * BigInt(item.weight);
      return { ...item, amount: Number(quotient / 10_000n), remainder: Number(quotient % 10_000n) };
    }).sort((a,b) => b.remainder-a.remainder || a.id.localeCompare(b.id));
  const missing = Math.abs(minor) - parts.reduce((total,item) => total + item.amount, 0);
  return new Map(parts.map((item,index) => [item.id, (item.amount + (index < missing ? 1 : 0)) * Math.sign(minor)]));
}

export function chargeShares(row: { project_id: string | null; allocations?: Allocation[] }) {
  return row.allocations ?? (row.project_id ? [{ projectId: row.project_id, basisPoints: 10_000 }] : []);
}
