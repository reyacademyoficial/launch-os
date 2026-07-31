import type { CSSProperties, ReactNode } from "react";

/**
 * KG · Panel. Contenedor glass con título y acciones opcionales. Padding
 * togglable — `pad={false}` para contenido edge-to-edge (tablas, breakdowns
 * que traen su propio padding).
 */
export function Panel({
  title,
  children,
  actions,
  pad = true,
  style,
}: {
  readonly title?: ReactNode;
  readonly children: ReactNode;
  readonly actions?: ReactNode;
  readonly pad?: boolean;
  readonly style?: CSSProperties;
}) {
  return (
    <div
      className="kg-glass"
      style={{
        borderRadius: "var(--kg-r-20)",
        overflow: "hidden",
        boxShadow: "var(--kg-shadow-amb)",
        ...style,
      }}
    >
      {title != null && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "16px 20px",
            borderBottom: "1px solid var(--kg-border-subtle)",
            gap: 10,
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: 13,
              fontWeight: 700,
              color: "var(--kg-text-1)",
            }}
          >
            {title}
          </h3>
          {actions}
        </div>
      )}
      <div style={{ padding: pad ? 20 : 0 }}>{children}</div>
    </div>
  );
}
