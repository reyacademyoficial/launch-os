import Link from "next/link";
import type { ReactNode } from "react";

// ═══════════════════════════════════════════════════════════════════════════
// KG · ViewToggle. Switch de dos íconos para alternar entre vistas (típico:
// tabla ⇄ calendario). Usa <Link> para permanecer server-friendly — la vista
// activa se resuelve desde searchParams en la page.
//
// Diseño: pill container con 2 botones adentro. El activo tiene fondo acento;
// el inactivo transparente. El aria-label del button carga la semántica para
// screen readers.
//
// Reusar en grabación y subidas (ambas tienen vista tabla|calendario). Si en
// el futuro aparecen 3 vistas, generalizar a un array de opciones — por ahora
// los 2 slots son suficientes.
// ═══════════════════════════════════════════════════════════════════════════

export interface ToggleOption {
  readonly value: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly href: string;
}

export function KgViewToggle({
  options,
  active,
  ariaLabel = "Cambiar vista",
}: {
  readonly options: readonly [ToggleOption, ToggleOption];
  readonly active: string;
  readonly ariaLabel?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{
        display: "inline-flex",
        padding: 3,
        gap: 2,
        borderRadius: 999,
        background: "var(--kg-surface-2-solid)",
        border: "1px solid var(--kg-border-subtle)",
      }}
    >
      {options.map((opt) => {
        const isActive = opt.value === active;
        return (
          <Link
            key={opt.value}
            href={opt.href}
            aria-label={opt.label}
            aria-pressed={isActive}
            title={opt.label}
            className="kg-focus"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 34,
              height: 28,
              borderRadius: 999,
              background: isActive ? "var(--kg-accent-500)" : "transparent",
              color: isActive ? "#fff" : "var(--kg-text-2)",
              textDecoration: "none",
              transition: "background var(--kg-dur) var(--kg-ease)",
            }}
          >
            {opt.icon}
          </Link>
        );
      })}
    </div>
  );
}
