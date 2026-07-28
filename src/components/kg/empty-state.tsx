import type { ReactNode } from "react";

/**
 * KG · EmptyState. Vacío como onboarding, no como "sin datos". Un ícono
 * dentro de un halo carmesí, título, hint opcional y acciones opcionales.
 */
export function EmptyState({
  title,
  hint,
  actions,
  icon,
}: {
  readonly title: string;
  readonly hint?: string;
  readonly actions?: ReactNode;
  readonly icon?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "44px 22px",
        textAlign: "center",
      }}
    >
      {icon && (
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: "var(--kg-r-16)",
            background: "var(--kg-accent-halo)",
            border: "1px solid var(--kg-border-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--kg-accent-text)",
            marginBottom: 14,
          }}
        >
          {icon}
        </div>
      )}
      <div
        className="kg-t4"
        style={{ color: "var(--kg-text-1)", marginBottom: 5 }}
      >
        {title}
      </div>
      {hint && (
        <div
          className="kg-t6"
          style={{
            color: "var(--kg-text-3)",
            maxWidth: 320,
            marginBottom: actions ? 16 : 0,
          }}
        >
          {hint}
        </div>
      )}
      {actions && (
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          {actions}
        </div>
      )}
    </div>
  );
}
