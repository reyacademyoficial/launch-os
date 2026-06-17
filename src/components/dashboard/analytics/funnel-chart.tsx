"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { fmtNumber, fmtPercent } from "@/lib/format";
import type { FunnelStage } from "@/lib/analytics/funnel";

/**
 * Embudo 3 etapas. Barras verticales descendentes (más natural para "se cae
 * la gente"). Cada barra muestra el count; arriba del nombre la tasa vs el
 * paso anterior (drop-off).
 *
 * Colores: ramped del accent. La idea es leer la barra alta de la izquierda
 * (todos los leads) bajar a la derecha (vendidos) y que se note el embudo.
 */
const STAGE_COLOR = ["#60a5fa", "#3b82f6", "#1d4ed8"];

export function FunnelChart({ stages }: { readonly stages: ReadonlyArray<FunnelStage> }) {
  if (stages.every((s) => s.count === 0)) {
    return (
      <p className="text-sm text-fg-muted">
        Sin leads en el filtro actual.
      </p>
    );
  }

  const data = stages.map((s) => ({
    name: s.label,
    count: s.count,
    rate: s.rateOfPrev,
    key: s.key,
  }));

  return (
    <div className="space-y-4">
      {/* Cards arriba con count + rate textual — útil cuando los números
          chicos se aplastan en la barra. */}
      <div className="grid gap-3 sm:grid-cols-3">
        {stages.map((s, i) => (
          <div
            key={s.key}
            className="rounded-md border border-border bg-surface/40 p-4"
          >
            <div className="text-xs uppercase tracking-wide text-fg-subtle">
              {s.label}
            </div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-fg">
              {fmtNumber(s.count)}
            </div>
            {i > 0 && (
              <div className="mt-1 text-xs text-fg-muted">
                {fmtPercent(s.rateOfPrev)} del paso anterior
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="h-72 rounded-md border border-border bg-surface/40 p-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgb(255 255 255 / 0.05)" />
            <XAxis dataKey="name" stroke="rgb(255 255 255 / 0.5)" />
            <YAxis stroke="rgb(255 255 255 / 0.5)" />
            <Tooltip
              contentStyle={{
                background: "rgb(0 0 0 / 0.85)",
                border: "1px solid rgb(255 255 255 / 0.1)",
                borderRadius: "6px",
                fontSize: "12px",
              }}
              formatter={(value: number, _name, props) => [
                `${fmtNumber(value)} (${fmtPercent(props.payload.rate)})`,
                "Leads",
              ]}
            />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {data.map((_, idx) => (
                <Cell key={idx} fill={STAGE_COLOR[idx]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
