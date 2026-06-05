/**
 * Number / date formatters, ported from the legacy prototype.
 * Pure, locale-stable (en-US), safe against NaN / Infinity.
 */

const safeNumber = (v: unknown, fallback = 0): number => {
  const n = typeof v === "number" ? v : parseFloat(v as string);
  return Number.isFinite(n) ? n : fallback;
};

const safeInt = (v: unknown, fallback = 0): number => {
  const n = typeof v === "number" ? Math.trunc(v) : parseInt(v as string, 10);
  return Number.isFinite(n) ? n : fallback;
};

/** "$1,234" — rounded whole dollars. Use for KPIs at-a-glance. */
export const fmtMoney = (n: unknown): string =>
  "$" + Math.round(safeNumber(n)).toLocaleString("en-US");

/** "$12.34" — two decimals. Use when precision matters (CPL, ROAS). */
export const fmtMoneyDecimals = (n: unknown): string =>
  "$" +
  safeNumber(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/** "12.3%" — one decimal. */
export const fmtPercent = (n: unknown): string => safeNumber(n).toFixed(1) + "%";

/** "1,234" — rounded integer. */
export const fmtNumber = (n: unknown): string =>
  safeInt(n).toLocaleString("en-US");

/** "2.34x" — multipliers like ROAS. */
export const fmtMultiplier = (n: unknown): string =>
  safeNumber(n).toFixed(2) + "x";

/** ISO date string `2026-06-05` → readable `5 jun 2026`. Falls back to raw on parse failure. */
export function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
