"use client";

export interface BreakdownPart {
  readonly l: string;
  readonly v: number;
}

/**
 * KG · Breakdown. Total que se abre en sus partes con barras monocromas.
 * Positivas en carmesí (accent-500), negativas en gris (neutral-700) — otra
 * excepción justificada a "el color no dice estado" porque acá el signo del
 * valor SÍ es la información que queremos remarcar (aporte vs resta).
 *
 * Client porque acepta `fmtFn`, una función que no es Server Action. Si en
 * algún módulo el fmt es trivial (String), sigue funcionando en un tree
 * client-rooted.
 */
export function Breakdown({
  total,
  totalLabel,
  parts,
  fmtFn = String,
}: {
  readonly total: number;
  readonly totalLabel: string;
  readonly parts: readonly BreakdownPart[];
  readonly fmtFn?: (v: number) => string;
}) {
  const mx = Math.max(...parts.map((p) => Math.abs(Number(p.v) || 0)), 1);

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 12,
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: "var(--kg-text-3)",
            textTransform: "uppercase",
            letterSpacing: ".5px",
          }}
        >
          {totalLabel}
        </span>
        <strong
          className="kg-num"
          style={{
            fontSize: 21,
            fontWeight: 700,
            color: "var(--kg-text-1)",
            letterSpacing: "-.5px",
          }}
        >
          {fmtFn(total)}
        </strong>
      </div>
      {parts.map((p, i) => {
        const v = Number(p.v) || 0;
        const width = Math.max(0, Math.min(100, (Math.abs(v) / mx) * 100));
        const isNegative = v < 0;
        return (
          <div key={i} style={{ marginBottom: 11 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12,
                marginBottom: 5,
              }}
            >
              <span style={{ color: "var(--kg-text-3)" }}>{p.l}</span>
              <strong
                className="kg-num"
                style={{ color: "var(--kg-text-2)", fontWeight: 600 }}
              >
                {fmtFn(v)}
              </strong>
            </div>
            <div
              style={{
                height: 4,
                borderRadius: 3,
                background: "var(--kg-surface-2-solid)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${width}%`,
                  background: isNegative
                    ? "var(--kg-neutral-700)"
                    : "var(--kg-accent-500)",
                  borderRadius: 3,
                  opacity: isNegative ? 0.8 : 0.9,
                  transition: "width var(--kg-dur-slow) var(--kg-ease)",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
