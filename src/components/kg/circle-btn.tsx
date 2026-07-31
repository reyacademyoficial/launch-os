"use client";

import type { ReactNode } from "react";

/**
 * KG · CircleBtn. Botón circular chico (26px) para drill-down / abrir drawer.
 * Ícono default = flecha diagonal ↗. Client component porque toma `onClick`.
 */
export function CircleBtn({
  onClick,
  title,
  children,
}: {
  readonly onClick?: () => void;
  readonly title: string;
  readonly children?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="kg-hov kg-focus"
      style={{
        width: 26,
        height: 26,
        borderRadius: 999,
        border: "1px solid var(--kg-border-default)",
        background: "var(--kg-surface-2-solid)",
        color: "var(--kg-text-2)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        padding: 0,
      }}
    >
      {children ?? (
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M7 17L17 7" />
          <path d="M9 7h8v8" />
        </svg>
      )}
    </button>
  );
}
