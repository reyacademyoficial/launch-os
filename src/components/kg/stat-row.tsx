import { StateDot } from "./state-dot";
import { toneOf } from "./tone";

export interface StatRowItem {
  readonly l: string;
  readonly v: string | number;
  /** Color hex opcional que se traduce a tono con `toneOf`. */
  readonly c?: string;
}

/**
 * KG · StatRow. Nivel 3 de la jerarquía: fila de estadísticas compacta, NO
 * es tarjeta. Reservada para métricas de apoyo que sub-agregan el KPI hero.
 * El dot semántico (si aplica) va después del valor, chico.
 */
export function StatRow({ items }: { readonly items: readonly StatRowItem[] }) {
  return (
    <div
      className="kg-glass"
      style={{
        borderRadius: "var(--kg-r-16)",
        padding: "11px 16px",
        display: "flex",
        gap: 26,
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      {items.map((s, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span className="kg-t6" style={{ color: "var(--kg-text-3)" }}>
            {s.l}
          </span>
          <strong
            className="kg-num"
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--kg-text-1)",
            }}
          >
            {s.v}
          </strong>
          <StateDot tone={toneOf(s.c)} size={4} />
        </div>
      ))}
    </div>
  );
}
