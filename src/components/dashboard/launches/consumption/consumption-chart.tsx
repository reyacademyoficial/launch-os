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

import type {
  ConsumptionCells,
  ConsumptionConfig,
} from "@/lib/launch-consumption/types";
import { readCell } from "@/lib/launch-consumption/metrics";

/**
 * Chart comparativo del consumo por clase: X = hora, Y = asistentes, una
 * línea por clase configurada. Recharts como en `DailyChart` para respetar
 * el resto del dashboard.
 *
 * La paleta se genera determinísticamente por índice de clase — mientras el
 * operador no reordene, el color de "Clase 1" es estable entre saves.
 */

const PALETTE = [
  "#ff006e", // accent-ish (rosado)
  "#06b6d4", // cyan
  "#a855f7", // violeta
  "#f59e0b", // ámbar
  "#22c55e", // verde
  "#3b82f6", // azul
  "#ef4444", // rojo
  "#eab308", // amarillo
  "#14b8a6", // teal
  "#f97316", // naranja
];

function colorFor(index: number): string {
  return PALETTE[index % PALETTE.length] ?? "#a1a1aa";
}

interface Props {
  readonly config: ConsumptionConfig;
  readonly cells: ConsumptionCells;
  readonly hourSlots: readonly string[];
}

export function ConsumptionChart({ config, cells, hourSlots }: Props) {
  if (hourSlots.length === 0 || config.classes.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-surface/40 p-6 text-center text-sm text-fg-muted">
        Configurá al menos una clase y una ventana horaria válida para ver el
        gráfico.
      </div>
    );
  }

  // Cada punto = una hora, con un campo por clase. Recharts consume esto
  // directo con Line dataKey={className}.
  const data = hourSlots.map((hour) => {
    const point: Record<string, string | number> = { hour };
    for (const className of config.classes) {
      point[className] = readCell(cells, hour, className);
    }
    return point;
  });

  // Ocultar clases sin ningún dato > 0 en todo el rango (mismo criterio que
  // DailyChart). Si el usuario cargó una clase nueva pero aún no puso datos,
  // no ensuciamos la leyenda con una línea plana en 0.
  const activeClasses = config.classes.filter((c) =>
    data.some((d) => (d[c] as number) > 0),
  );

  const hasAnyData = activeClasses.length > 0;

  return (
    <div className="space-y-2">
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 16, left: 16, bottom: 36 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis
              dataKey="hour"
              stroke="var(--color-fg-muted)"
              tick={{ fontSize: 11 }}
              tickMargin={6}
              label={{
                value: "Hora",
                position: "insideBottom",
                offset: -16,
                fill: "var(--color-fg-muted)",
                fontSize: 12,
              }}
            />
            <YAxis
              stroke="var(--color-fg-muted)"
              tick={{ fontSize: 11 }}
              allowDecimals={false}
              width={48}
              label={{
                value: "Asistentes",
                angle: -90,
                position: "insideLeft",
                offset: 8,
                fill: "var(--color-fg-muted)",
                fontSize: 12,
                style: { textAnchor: "middle" },
              }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              verticalAlign="top"
              align="right"
              height={28}
              wrapperStyle={{ fontSize: 12 }}
            />
            {config.classes.map((className, idx) => (
              <Line
                key={className}
                type="monotone"
                dataKey={className}
                stroke={colorFor(idx)}
                strokeWidth={2}
                dot={{ r: 2 }}
                activeDot={{ r: 4 }}
                connectNulls
                name={className}
                hide={!activeClasses.includes(className)}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {!hasAnyData && (
        <p className="px-2 text-[11px] text-fg-subtle">
          Aún no cargaste asistentes en ninguna clase. Completá la grilla de
          arriba para ver la comparativa.
        </p>
      )}
    </div>
  );
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  readonly active?: boolean;
  readonly payload?: ReadonlyArray<{
    dataKey?: string | number;
    name?: string;
    value?: number;
    color?: string;
  }>;
  readonly label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const visible = payload.filter(
    (p) => typeof p.value === "number" && p.value > 0,
  );
  if (visible.length === 0) return null;

  return (
    <div
      style={{
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
        borderRadius: "6px",
        padding: "8px 10px",
        fontSize: "12px",
        color: "var(--color-fg)",
      }}
    >
      <div style={{ marginBottom: 4, fontWeight: 600 }}>{label}</div>
      {visible.map((p) => (
        <div
          key={String(p.dataKey)}
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: p.color ?? "var(--color-fg-muted)",
            }}
          />
          <span>{p.name}:</span>
          <span style={{ fontWeight: 600 }}>{p.value ?? 0}</span>
        </div>
      ))}
    </div>
  );
}
