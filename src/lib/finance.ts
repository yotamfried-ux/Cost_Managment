export type Evidence = "verified" | "provider" | "estimate" | "missing";
export const evidenceLabels: Record<Evidence, string> = {
  verified: "מאומת", provider: "נתוני ספק", estimate: "אומדן", missing: "חסר מקור",
};

export const currencies = ["ILS", "USD", "EUR", "GBP", "CAD", "JPY", "CHF", "AUD", "SEK", "INR"] as const;
export type Currency = (typeof currencies)[number];
export const shekels = (value: number) => formatMoney(value, "ILS");
export function formatMoney(minor: number, currency: string) {
  const options = new Intl.NumberFormat("he-IL", { style: "currency", currency });
  return options.format(minor / 10 ** (options.resolvedOptions().maximumFractionDigits ?? 2));
}

export function minorUnits(value: string, currency: Currency): number {
  const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  if (!/^\d{1,10}(\.\d{1,3})?$/.test(value)) throw new Error("invalid amount");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > digits) throw new Error("invalid currency precision");
  return Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0"));
}

export function businessDate(now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function monthOffset(month: string, offset: number) {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 1 + offset, 1)).toISOString().slice(0, 7);
}

export function resolveMonth(value?: string) {
  return value && /^20\d{2}-(0[1-9]|1[0-2])$/.test(value) ? value : businessDate().slice(0, 7);
}

export function monthTitle(month: string) {
  return new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(month + "-01T12:00:00Z"));
}

export function safeCsv(values: (string | number | null)[][]) {
  return "\uFEFF" + values.map(row => row.map(value => {
    let cell = String(value ?? "");
    if (typeof value === "string" && (/^[\s]*[=+@-]/.test(cell) || /^[\t\r\n]/.test(cell))) cell = "'" + cell;
    return '"' + cell.replaceAll('"', '""') + '"';
  }).join(",")).join("\r\n");
}
