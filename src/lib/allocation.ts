export type Allocation = { projectId: string; basisPoints: number };

export function roundParts(values: number[], roundedTotal: number) {
  const parts = values.map((value, index) => ({ index, whole: Math.floor(value), fraction: value - Math.floor(value) }));
  const extra = roundedTotal - parts.reduce((sum, part) => sum + part.whole, 0);
  if (extra < 0 || extra > parts.length) throw new Error("Invalid rounded parts");
  parts.sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  const result: number[] = [];
  parts.forEach(({ index, whole }, position) => { result[index] = whole + Number(position < extra); });
  return result;
}

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
