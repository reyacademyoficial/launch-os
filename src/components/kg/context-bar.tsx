import type { ReactNode } from "react";

import { StateDot } from "./state-dot";
import { toneOf } from "./tone";

export interface ContextBarStat {
  readonly l: string;
  readonly v: string | number;
  readonly c?: string;
}

/**
 * KG · ContextBar. Barra STICKY con el contexto de la vista mientras el
 * usuario scrollea. `top: 62` deja espacio a la topbar (ajustable si el
 * shell cambia de altura). Usa glass-2 para diferenciar del header.
 */
export function ContextBar({
  icon,
  title,
  stats,
  top = 62,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly stats?: readonly ContextBarStat[];
  readonly top?: number;
}) {
  return (
    <div
      className="kg-glass-2"
      style={{
        position: "sticky",
        top,
        zIndex: 40,
        borderRadius: "var(--kg-r-16)",
        border: "1px solid var(--kg-border-subtle)",
        padding: "12px 20px",
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
        boxShadow: "var(--kg-shadow-amb)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: "var(--kg-r-8)",
            background: "var(--kg-surface-2-solid)",
            border: "1px solid var(--kg-border-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--kg-text-3)",
          }}
        >
          {icon}
        </div>
        <span
          className="kg-t5"
          style={{ color: "var(--kg-text-1)", fontWeight: 700 }}
        >
          {title}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          gap: 20,
          flexWrap: "wrap",
          marginLeft: "auto",
        }}
      >
        {(stats ?? []).map((s, i) => (
          <div
            key={i}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <span style={{ fontSize: 11, color: "var(--kg-text-3)" }}>
              {s.l}
            </span>
            <strong
              className="kg-num"
              style={{
                fontSize: 12.5,
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
    </div>
  );
}
