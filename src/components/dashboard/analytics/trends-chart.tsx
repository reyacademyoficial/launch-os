"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { fmtMoney, fmtPercent } from "@/lib/format";

/**
 * Tick formatter compacto para el eje Y de moneda. Recharts solo pinta
 * los ticks en el ancho dado por `width`; si los strings son largos
 * ("$1,500,000") se cortan o solapan. Formato compacto deja
 * "$1.5M" / "$120K" — el tooltip sigue mostrando el monto completo
 * con `fmtMoney`.
 */
function fmtMoneyCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

/**
 * Tendencias entre lanzamientos. Eje X = launches ordenados por date_start
 * ascendente (los más viejos a la izquierda). Líneas:
 *   - Revenue, Profit, CPL agregado (moneda — eje Y izquierdo)
 *   - Close rate (% — eje Y derecho)
 *
 * Pasamos los datos ya pre-calculados desde el server. La conversión
 * launch → punto la hace el page.tsx con `calculateLaunchKPIs`.
 */
export interface TrendsPoint {
  launchId: string;
  name: string;
  /** YYYY-MM-DD o null si el launch no tiene fecha. */
  dateStart: string | null;
  revenue: number;
  profit: number;
  cpl: number;
  closeRate: number;
}

export function TrendsChart({ points }: { readonly points: ReadonlyArray<TrendsPoint> }) {
  if (points.length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        Sin lanzamientos en el filtro actual.
      </p>
    );
  }
  if (points.length === 1) {
    return (
      <p className="text-sm text-fg-muted">
        Hace falta al menos 2 lanzamientos para mostrar tendencia. Ajustá el
        filtro.
      </p>
    );
  }

  return (
    <div className="h-96 rounded-md border border-border bg-surface/40 p-4">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={points as TrendsPoint[]}
          margin={{ top: 10, right: 20, bottom: 10, left: 10 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(255 255 255 / 0.05)" />
          <XAxis dataKey="name" stroke="rgb(255 255 255 / 0.5)" />
          <YAxis
            yAxisId="money"
            stroke="rgb(255 255 255 / 0.5)"
            width={70}
            tickFormatter={(v) => fmtMoneyCompact(v as number)}
          />
          <YAxis
            yAxisId="pct"
            orientation="right"
            stroke="rgb(255 255 255 / 0.5)"
            width={55}
            tickFormatter={(v) => fmtPercent(v as number)}
          />
          <Tooltip
            contentStyle={{
              background: "rgb(0 0 0 / 0.85)",
              border: "1px solid rgb(255 255 255 / 0.1)",
              borderRadius: "6px",
              fontSize: "12px",
            }}
            formatter={(value: number, name) => {
              if (name === "Close rate") return [fmtPercent(value), name];
              return [fmtMoney(value), name];
            }}
          />
          <Legend wrapperStyle={{ fontSize: "12px" }} />
          <Line
            yAxisId="money"
            type="monotone"
            dataKey="revenue"
            name="Revenue"
            stroke="#22c55e"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
          <Line
            yAxisId="money"
            type="monotone"
            dataKey="profit"
            name="Profit"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
          <Line
            yAxisId="money"
            type="monotone"
            dataKey="cpl"
            name="CPL"
            stroke="#f59e0b"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
          <Line
            yAxisId="pct"
            type="monotone"
            dataKey="closeRate"
            name="Close rate"
            stroke="#ec4899"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
