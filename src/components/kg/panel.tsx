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
  fillHeight = false,
}: {
  readonly title?: ReactNode;
  readonly children: ReactNode;
  readonly actions?: ReactNode;
  readonly pad?: boolean;
  readonly style?: CSSProperties;
  /**
   * true = el Panel toma altura completa dentro de su parent flex (usando
   * `flex-1 min-h-0`) y el body pasa a ser un flex column que también
   * flex-fill. Habilita el pattern donde una tabla adentro corre `flex-1
   * min-h-0 overflow-auto` para scrollear internamente sin necesitar
   * `maxBodyHeight` con offsets `calc(100vh - Xpx)` fijos.
   *
   * Requiere que TODOS los ancestros hasta el shell sean flex columns con
   * `min-h-0` para que la altura se propague correctamente.
   */
  readonly fillHeight?: boolean;
}) {
  return (
    <div
      className={`kg-glass${fillHeight ? " flex min-h-0 flex-1 flex-col" : ""}`}
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
            flexShrink: 0,
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
      <div
        className={fillHeight ? "flex min-h-0 flex-1 flex-col" : undefined}
        style={{ padding: pad ? 20 : 0 }}
      >
        {children}
      </div>
    </div>
  );
}
