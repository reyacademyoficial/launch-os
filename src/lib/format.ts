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

/**
 * ISO date string → readable `5 jun 2026`. Falls back to raw on parse failure.
 *
 * Distingue dos casos para evitar el off-by-one por timezone:
 *  - `YYYY-MM-DD` (DATE en Postgres, sin TZ): `new Date(s)` lo interpreta como
 *    UTC medianoche; sin `timeZone: 'UTC'`, `toLocaleDateString` en Buenos Aires
 *    (UTC−3) lo formatea como el día anterior. Lo armamos a mano en UTC.
 *  - timestamptz (con hora + zona): `new Date(s)` ya devuelve el instante
 *    correcto; lo formateamos en zona local del browser, que es lo esperado.
 */
export function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    if (y && m && d) {
      return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("es-AR", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
    }
  }

  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Formats a launch's [start, end] window for display.
 *   start + end → "5 jun 2026 → 12 jun 2026"
 *   start only  → "Desde 5 jun 2026"
 *   end only    → "Hasta 12 jun 2026"
 *   neither     → "—"
 */
export function fmtLaunchWindow(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  if (start && end) return `${fmtDate(start)} → ${fmtDate(end)}`;
  if (start) return `Desde ${fmtDate(start)}`;
  if (end) return `Hasta ${fmtDate(end)}`;
  return "—";
}
