"use client";

import { RadialBar, RadialBarChart, ResponsiveContainer } from "recharts";

/**
 * KG · Gauge. Medidor radial (arco de 260°, hueco al centro para el número).
 *
 * El color lo elige el módulo llamador según su umbral — no hay tabla global
 * de "% → color". El artefacto original pasaba el color inline; acá exigimos
 * `color` como prop obligatoria para que la responsabilidad quede clara.
 *
 * `pct` entra en [0, 100] (se clampea). El texto central (`label`) se dibuja
 * absolute sobre el chart — recharts no ofrece un slot central nativo.
 */
export function Gauge({
  pct,
  label,
  color,
  size = 140,
  sublabel,
}: {
  readonly pct: number;
  readonly label: string;
  readonly color: string;
  readonly size?: number;
  readonly sublabel?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  const data = [{ name: "v", value: clamped, fill: color }];

  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        display: "inline-block",
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          innerRadius="70%"
          outerRadius="100%"
          data={data}
          startAngle={220}
          endAngle={-40}
          barSize={10}
        >
          <RadialBar
            dataKey="value"
            background={{ fill: "var(--kg-surface-2-solid)" }}
            cornerRadius={999}
            fill={color}
          />
        </RadialBarChart>
      </ResponsiveContainer>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        <div
          className="kg-num"
          style={{
            fontSize: size / 4.5,
            fontWeight: 800,
            color: "var(--kg-text-1)",
            letterSpacing: "-0.5px",
            lineHeight: 1,
          }}
        >
          {label}
        </div>
        {sublabel && (
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-3)", marginTop: 4 }}
          >
            {sublabel}
          </div>
        )}
      </div>
    </div>
  );
}
