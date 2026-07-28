import type { ReactNode } from "react";

import { StateDot } from "./state-dot";
import { toneOf } from "./tone";

export interface SectionHeaderStat {
  readonly l: string;
  readonly v: string | number;
  readonly c?: string;
}

/**
 * KG · SectionHeader. Header de sección con ícono + título + stats inline a
 * la derecha. Distinto del ContextBar en que NO es sticky.
 */
export function SectionHeader({
  icon,
  title,
  stats,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly stats?: readonly SectionHeaderStat[];
}) {
  return (
    <div
      className="kg-glass"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
        borderRadius: "var(--kg-r-16)",
        padding: "14px 20px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          minWidth: 0,
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "var(--kg-r-8)",
            background: "var(--kg-surface-2-solid)",
            border: "1px solid var(--kg-border-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--kg-text-3)",
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
        <span
          style={{
            fontWeight: 700,
            color: "var(--kg-text-1)",
            fontSize: 13.5,
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          gap: 18,
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
                fontSize: 13,
                color: "var(--kg-text-1)",
                fontWeight: 600,
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
