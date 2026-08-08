import type { ReactNode } from "react";

import { EmptyState } from "./empty-state";
import { fCount } from "@/lib/finance/format";

/**
 * KG · DataTable. Tabla de PRESENTACIÓN pura — sin fetch, sin orden, sin
 * filtros propios. El caller (server component) trae las filas y define las
 * columnas.
 *
 * REGLA DE ORO — la plata NO se pinta.
 * El color vive en StateDot y StatusPill. En una celda de monto, el signo
 * menos es la única señal de dirección. Si necesitás una pill (status, tipo
 * in/out, etc.) usá `render` y devolvé un <StatusPill> — no pintes el número.
 *
 * Números alineados a la derecha con `kg-num` + `tabular-nums` (fuente
 * monoespaciada de dígitos). En una tabla financiera esto es no negociable —
 * columnas de importes tienen que "cerrar" verticalmente para que el ojo
 * detecte magnitudes de un vistazo.
 *
 * `totalCount` alimenta el footer "N de M". Si el caller ya trajo TODAS las
 * filas (no hay paginación), pasar `rows.length` como total — o omitirlo y
 * mostramos solo el conteo de las filas visibles.
 *
 * Sin cabezera sticky: el header queda dentro del panel scrolleable de cada
 * pestaña. Si el listado crece, la paginación se resuelve por `searchParams`,
 * no por scroll infinito.
 */

export type ColumnAlign = "left" | "right" | "center";

export interface Column<Row> {
  readonly key: string;
  readonly label: string;
  /** Cómo alinear cabecera Y celda. Default: 'left'. Números → 'right'. */
  readonly align?: ColumnAlign;
  /** Ancho fijo (CSS width). Opcional — sin esto la columna es fluida. */
  readonly width?: string;
  /**
   * Render de la celda. Devolver un string/number para valores simples; JSX
   * para composiciones (pills, links, dashes con tooltip, etc.).
   */
  readonly render: (row: Row) => ReactNode;
  /**
   * Marca la columna como "numérica" — activa `kg-num` + tabular-nums en la
   * celda (independiente del alineamiento, aunque casi siempre van juntos).
   */
  readonly numeric?: boolean;
}

export interface DataTableProps<Row> {
  readonly columns: ReadonlyArray<Column<Row>>;
  readonly rows: ReadonlyArray<Row>;
  /** Key extractor para el key del <tr>. */
  readonly rowKey: (row: Row) => string;
  /**
   * Total de filas EN LA FUENTE (no las visibles). Si la página es 20 de 340,
   * pasar 340. Si trajiste todas, pasar `rows.length` o omitirlo.
   */
  readonly totalCount?: number;
  /** Contenido a mostrar cuando `rows.length === 0`. Requerido. */
  readonly emptyTitle: string;
  readonly emptyHint?: string;
  /**
   * Cuando se seta, el <tbody> scrollea internamente con este max-height
   * (ej. `"calc(100vh - 340px)"` o `"60vh"`) y el <thead> queda sticky. Sin
   * esto la tabla crece a lo alto y el scroll queda a nivel de página.
   */
  readonly maxBodyHeight?: string;
  /**
   * Slot opcional en la MISMA fila del footer "X de Y registros" — para
   * inyectar el paginador y evitar que ocupe una franja aparte.
   */
  readonly footerActions?: ReactNode;
}

export function KgDataTable<Row>({
  columns,
  rows,
  rowKey,
  totalCount,
  emptyTitle,
  emptyHint,
  maxBodyHeight,
  footerActions,
}: DataTableProps<Row>) {
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} hint={emptyHint} />;
  }

  const total = totalCount ?? rows.length;
  const showingRange =
    total === rows.length
      ? `${fCount(total)} ${total === 1 ? "registro" : "registros"}`
      : `${fCount(rows.length)} de ${fCount(total)} registros`;

  const scrollStyle = maxBodyHeight
    ? { overflow: "auto" as const, maxHeight: maxBodyHeight }
    : { overflowX: "auto" as const };

  const stickyThStyle: React.CSSProperties | undefined = maxBodyHeight
    ? {
        position: "sticky",
        top: 0,
        zIndex: 1,
        background: "var(--kg-surface-1-solid)",
      }
    : undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={scrollStyle}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 12.5,
          }}
        >
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  style={{
                    textAlign: c.align ?? "left",
                    padding: "10px 14px",
                    borderBottom: "1px solid var(--kg-border-subtle)",
                    color: "var(--kg-text-3)",
                    fontWeight: 600,
                    fontSize: 11,
                    letterSpacing: 0.2,
                    textTransform: "uppercase",
                    width: c.width,
                    whiteSpace: "nowrap",
                    ...stickyThStyle,
                  }}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                className="kg-row"
                style={{
                  borderBottom: "1px solid var(--kg-border-subtle)",
                }}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={c.numeric ? "kg-num" : undefined}
                    style={{
                      textAlign: c.align ?? "left",
                      padding: "10px 14px",
                      color: "var(--kg-text-1)",
                      fontVariantNumeric: c.numeric ? "tabular-nums" : undefined,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div
        style={{
          padding: "10px 14px",
          borderTop: "1px solid var(--kg-border-subtle)",
          color: "var(--kg-text-3)",
          fontSize: 11,
          fontVariantNumeric: "tabular-nums",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span>{showingRange}</span>
        {footerActions}
      </div>
    </div>
  );
}
