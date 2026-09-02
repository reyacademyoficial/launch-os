import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { EmptyState } from "./empty-state";
import { fCount } from "@/lib/finance/format";

/**
 * KG · DataTable. Tabla de PRESENTACIÓN pura — sin fetch, sin estado propio.
 * El caller (server component o client view) trae las filas, define las
 * columnas y — si las usa — es dueño del sort y de la selección.
 *
 * REGLA DE ORO — la plata NO se pinta.
 * El color vive en StateDot y StatusPill. En una celda de monto, el signo
 * menos es la única señal de dirección. Si necesitás una pill (status, tipo
 * in/out, etc.) usá `render` y devolvé un <StatusPill> — no pintes el número.
 * Vale también para la fila de totales: `totalsRow` acepta ReactNode, pero el
 * total sigue sin color (hoy `cobros-view` pinta el vencido de rojo — al
 * migrar, ese rojo se reemplaza por un StateDot al lado del número).
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
 * ───────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTE ARCHIVO NO LLEVA "use client" (ni un solo hook)
 * ───────────────────────────────────────────────────────────────────────────
 * Hay páginas SERVER que renderizan esta tabla hoy (`financiero/reportes/*`,
 * `financiero/transferencias`, `marketing`, `marketing/stock`,
 * `academia/…/reporte-mensual`). En la condición de export `react-server`,
 * React 19 ni siquiera exporta `useState`: un solo `import { useState } from
 * "react"` en ESTE módulo rompería el build de esas páginas. Y marcar el
 * archivo entero "use client" arrastraría todas esas páginas al bundle de
 * cliente — lo contrario de lo que busca el chasis KG.
 *
 * Por eso las tres capacidades nuevas son **totalmente controladas**: el
 * estado (sort, selección) vive en el caller, que o ya es client
 * (`leads-table`, `cobros-view`) o lo resuelve por URL sin JS (páginas server,
 * vía `sort.hrefFor`). La tabla solo dibuja y avisa. Consecuencia práctica:
 * un server component NO puede pasar `selection` ni `sort.onChange` (serían
 * funciones dentro del payload RSC); sí puede pasar `sort.hrefFor`, que es
 * orden server-side con cero JS. Todo lo nuevo es OPT-IN — la API vieja
 * compila igual.
 *
 * Sin cabecera sticky salvo que el body scrollee (`fillHeight` /
 * `maxBodyHeight`): ahí el <thead> se pega arriba y el <tfoot> de totales
 * abajo.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * EJEMPLO REAL — forma de datos de `cobros-view` (tabla "Ventas cerradas")
 * ───────────────────────────────────────────────────────────────────────────
 *
 *   "use client";
 *   const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
 *   const sp = useSearchParams();
 *   const router = useRouter();
 *   const sort = readSortParams(sp, {
 *     allowed: ["alumno", "pactado", "cobrado"] as const,
 *     defaultKey: "alumno",
 *   });
 *
 *   <KgDataTable
 *     rows={sales}
 *     rowKey={(s) => s.id}
 *     emptyTitle="Sin ventas en columna cerrado para este lanzamiento."
 *     fillHeight
 *     columns={[
 *       { key: "alumno", label: "Alumno", sortable: true,
 *         render: (s) => leadById.get(s.lead_id)?.name ?? "—" },
 *       { key: "pactado", label: "Pactado", align: "right", numeric: true,
 *         sortable: true,
 *         render: (s) => fmtRowMoney(Number(s.total_amount) || 0, s.id) },
 *       { key: "cobrado", label: "Cobrado", align: "right", numeric: true,
 *         render: (s) => fmtRowMoney(collectedBySale.get(s.id) ?? 0, s.id) },
 *       { key: "vencido", label: "Vencido", align: "right", numeric: true,
 *         render: (s) => <OverdueCell sale={s} /> },
 *       { key: "cuotas", label: "Cuotas venc.", align: "right", numeric: true,
 *         render: (s) => fCount(overdueBySale.get(s.id)?.overdueCount ?? 0) },
 *     ]}
 *     sort={{
 *       key: sort.key,
 *       dir: sort.dir,
 *       onChange: (key, dir) =>
 *         router.replace("?" + applySortParams(sp, key, dir), { scroll: false }),
 *     }}
 *     selection={canEdit ? {
 *       selectedIds,
 *       onToggleRow: (id, on) =>
 *         setSelectedIds((prev) => {
 *           const next = new Set(prev);
 *           if (on) next.add(id); else next.delete(id);
 *           return next;
 *         }),
 *       onToggleAll: (on, ids) => setSelectedIds(on ? new Set(ids) : new Set()),
 *       rowLabel: (s) =>
 *         "Seleccionar venta de " + (leadById.get(s.lead_id)?.name ?? "sin alumno"),
 *     } : undefined}
 *     totalsRow={{
 *       label: filtersActive
 *         ? "Subtotal filtrado · " + fCount(sales.length) + " ventas"
 *         : "Total · " + fCount(sales.length) + " ventas",
 *       labelSpan: 1,            // cubre "Alumno"; la col del check se suma sola
 *       cells: {
 *         pactado: fmtTotalMoney(totalPactado),
 *         cobrado: fmtTotalMoney(totalCobrado),
 *         vencido: totalVencido > 0 ? fmtTotalMoney(totalVencido) : "—",
 *         cuotas: totalCuotasVencidas > 0 ? fCount(totalCuotasVencidas) : "—",
 *       },
 *     }}
 *     footerActions={<KgPaginator page={page} pageSize={50} totalCount={total}
 *                                 hrefFor={hrefForPage} compact />}
 *   />
 *
 *   <KgSelectionBar count={selectedIds.size} onClear={() => setSelectedIds(new Set())}>
 *     <select style={smallBtn} onChange={…}>…asignar producto…</select>
 *   </KgSelectionBar>
 */

export type ColumnAlign = "left" | "right" | "center";

/** Dirección de orden. Mismo vocabulario que `lib/leads/search-config`. */
export type SortDir = "asc" | "desc";

export interface Column<Row> {
  readonly key: string;
  /**
   * Texto o nodo del header. Se acepta ReactNode para poder embeder controles
   * (ej. checkbox "Seleccionar visibles") en la cabecera de la columna, sin
   * tener que abrir un toolbar aparte encima de la tabla.
   */
  readonly label: ReactNode;
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
  /**
   * Habilita click-para-ordenar en el header. Solo las columnas que lo
   * declaran son ordenables — igual que `SORTABLE_COLUMNS` en leads, donde
   * "Contacto", "Email" y "Setter" no lo son. Requiere `sort` en la tabla.
   */
  readonly sortable?: boolean;
  /**
   * Valor que viaja en `?sort=`. Default: `key`. Se separa porque la key de
   * la columna es de presentación y el param es contrato con el server (ej.
   * columna `cargado` → `?sort=created_at`, tal como hace leads hoy).
   */
  readonly sortKey?: string;
}

/**
 * Fila de totales fija al pie. Derivada de tres consumidores que hoy la
 * arman a mano:
 *
 *   - `cobros-view` → label con colSpan sobre [checkbox + Alumno] y totales
 *     en pactado/cobrado/vencido/cuotas. De ahí sale `labelSpan`: el caller
 *     cuenta SOLO sus columnas, la del checkbox se suma sola (hoy tiene que
 *     calcular `totalColSpan = canEdit ? 2 : 1` a mano).
 *   - `stage-table` (presupuesto) → "Total" | monto | "100.0%" | vacío.
 *   - `channels-tables` → totales de leads/inversión.
 *
 * `cells` va indexado por `Column.key` para que ancho, alineación y `numeric`
 * salgan de la definición de la columna y no puedan desalinearse. Las columnas
 * ausentes del record quedan vacías (el caso "acciones" de stage-table).
 */
export interface TotalsRow {
  /** Etiqueta de la fila. Ej: "Total", "Subtotal filtrado · 12 ventas". */
  readonly label?: ReactNode;
  /** Cuántas columnas del caller cubre el label. Default 1. */
  readonly labelSpan?: number;
  /** Valor por `Column.key`. Ausente = celda vacía. */
  readonly cells: Readonly<Record<string, ReactNode>>;
}

/**
 * Selección múltiple CONTROLADA. Decisión de diseño derivada de los dos
 * consumidores reales:
 *
 *   - `leads-table` limpia la selección cuando cambia la URL (los IDs dejan
 *     de estar visibles) y también después de cada bulk action.
 *   - `cobros-view` intersecta la selección con los IDs visibles
 *     (`effectiveSelected`) para que un filtro no deje IDs fantasma, y le
 *     pasa `Array.from(selected)` a la server action.
 *
 * Los dos NECESITAN el Set en su propio scope: para mandarlo al server y para
 * resetearlo desde afuera de la tabla. Una selección no controlada los
 * obligaría a espejarla igual — dos fuentes de verdad y un `useEffect` de
 * sincronización, justo lo que `react-hooks/set-state-in-effect` prohíbe.
 * Y sin hooks acá el archivo sigue siendo server-safe (ver cabecera).
 */
export interface DataTableSelection<Row> {
  readonly selectedIds: ReadonlySet<string>;
  /** `id` sale de `rowKey(row)`. `selected` es el estado DESEADO. */
  readonly onToggleRow: (id: string, selected: boolean, row: Row) => void;
  /**
   * Checkbox del header. `visibleIds` son los IDs seleccionables de la página
   * actual — el caller no tiene que recalcularlos.
   */
  readonly onToggleAll: (
    selected: boolean,
    visibleIds: ReadonlyArray<string>,
  ) => void;
  /** aria-label del checkbox de fila. Default: "Seleccionar fila". */
  readonly rowLabel?: (row: Row) => string;
  /** Filas no seleccionables (ej. una fila agregada). Default: todas lo son. */
  readonly isSelectable?: (row: Row) => boolean;
  /** aria-label del checkbox del header. */
  readonly headerLabel?: string;
}

/**
 * Orden por header. El estado NO vive en `useState`: vive en `?sort=&dir=`,
 * mismo contrato que `leads-table` (params `sort` / `dir`, valores
 * `asc|desc`, y cualquier cambio resetea `page`).
 *
 * Dos formas de disparar el cambio:
 *   - `onChange` → client view con `router.replace` (leads, cobros).
 *   - `hrefFor`  → el header es un <Link>; funciona en páginas SERVER, sin JS.
 * Si vienen las dos, gana `onChange` (evita la doble navegación).
 */
export interface DataTableSort {
  /** Columna ordenada hoy (el `sortKey` de la columna). null = ninguna. */
  readonly key: string | null;
  readonly dir: SortDir;
  readonly onChange?: (key: string, dir: SortDir) => void;
  readonly hrefFor?: (key: string, dir: SortDir) => string;
}

export interface DataTableProps<Row> {
  readonly columns: ReadonlyArray<Column<Row>>;
  readonly rows: ReadonlyArray<Row>;
  /** Key extractor para el key del <tr> y para el id de selección. */
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
   *
   * DEPRECATED en favor de `fillHeight` — offset fijo no se adapta a
   * viewports distintos. Se mantiene para pages que aún no migraron.
   */
  readonly maxBodyHeight?: string;
  /**
   * true = el body scrollea internamente y crece a llenar el espacio
   * disponible en su parent flex (`flex-1 min-h-0`). El footer queda
   * pegado al fondo. Requiere que el Panel padre use `fillHeight` y que
   * los ancestros propaguen la altura con `flex flex-col h-full min-h-0`.
   *
   * Mutuamente exclusivo con `maxBodyHeight` — si ambos vienen, gana este.
   */
  readonly fillHeight?: boolean;
  /**
   * Slot opcional en la MISMA fila del footer "X de Y registros" — para
   * inyectar el paginador y evitar que ocupe una franja aparte.
   */
  readonly footerActions?: ReactNode;
  /**
   * Fila de totales al pie. Con `fillHeight`/`maxBodyHeight` queda STICKY:
   * no scrollea con el body, siempre a la vista. Ver `TotalsRow`.
   */
  readonly totalsRow?: TotalsRow;
  /** Selección múltiple controlada. Ver `DataTableSelection`. */
  readonly selection?: DataTableSelection<Row>;
  /** Orden sincronizado a la URL. Ver `DataTableSort`. */
  readonly sort?: DataTableSort;
}

// ─── Contrato de URL del sort ──────────────────────────────────────────────
// Copiado tal cual de `leads-table` para no inventar un segundo dialecto:
// `?sort=<key>&dir=asc|desc`, y todo cambio de orden vuelve a página 1.

export const KG_SORT_PARAM = "sort";
export const KG_SORT_DIR_PARAM = "dir";
/** Params que un cambio de orden invalida (misma regla que leads). */
const RESET_ON_SORT = ["page"];

/**
 * Dirección siguiente al clickear `key`: primera vez `asc`; si ya estaba en
 * `asc` sobre esa misma columna, `desc`; si estaba en `desc`, vuelve a `asc`.
 * (Idéntico al `toggleSort` de leads-table.)
 */
export function nextSortDir(
  current:
    | { readonly key: string | null; readonly dir: SortDir }
    | null
    | undefined,
  key: string,
): SortDir {
  if (!current || current.key !== key) return "asc";
  return current.dir === "asc" ? "desc" : "asc";
}

/**
 * Acepta tanto `URLSearchParams` / `ReadonlyURLSearchParams` (client) como el
 * objeto `searchParams` de una page server. Así la MISMA función parsea el
 * orden en los dos lados sin que el caller normalice nada.
 */
type ParamsLike =
  | URLSearchParams
  | Readonly<Record<string, string | ReadonlyArray<string> | undefined>>;

function isSearchParams(params: ParamsLike): params is URLSearchParams {
  return typeof (params as URLSearchParams).get === "function";
}

function readParam(params: ParamsLike, name: string): string | null {
  if (isSearchParams(params)) return params.get(name);
  const raw = params[name];
  if (Array.isArray(raw)) return raw[0] ?? null;
  return typeof raw === "string" ? raw : null;
}

/**
 * Lee `?sort=&dir=` validando contra la lista de columnas ordenables. Sirve
 * en server (searchParams de la page, para ordenar la query) y en client
 * (para pintar la flecha del header). Nunca devuelve una key inválida.
 */
export function readSortParams<K extends string>(
  params: ParamsLike,
  opts: {
    readonly allowed: ReadonlyArray<K>;
    readonly defaultKey: K;
    readonly defaultDir?: SortDir;
  },
): { readonly key: K; readonly dir: SortDir } {
  const rawKey = readParam(params, KG_SORT_PARAM);
  const rawDir = readParam(params, KG_SORT_DIR_PARAM);
  const key = opts.allowed.find((k) => k === rawKey) ?? opts.defaultKey;
  const dir: SortDir =
    rawDir === "asc" || rawDir === "desc" ? rawDir : (opts.defaultDir ?? "asc");
  return { key, dir };
}

/**
 * Devuelve un `URLSearchParams` NUEVO con el orden aplicado y `page`
 * eliminado. No muta el original (los searchParams de Next son readonly).
 * Uso: `router.replace("?" + applySortParams(sp, key, dir))`.
 */
export function applySortParams(
  params: ParamsLike,
  key: string,
  dir: SortDir,
): URLSearchParams {
  const next = isSearchParams(params)
    ? new URLSearchParams(params.toString())
    : toSearchParams(params);
  next.set(KG_SORT_PARAM, key);
  next.set(KG_SORT_DIR_PARAM, dir);
  for (const p of RESET_ON_SORT) next.delete(p);
  return next;
}

function toSearchParams(
  record: Readonly<Record<string, string | ReadonlyArray<string> | undefined>>,
): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(record)) {
    if (typeof v === "string") out.set(k, v);
    else if (Array.isArray(v)) for (const item of v) out.append(k, item);
  }
  return out;
}

// ─── Tabla ─────────────────────────────────────────────────────────────────

const CHECK_COL_WIDTH = "36px";
/** Alto reservado bajo el footer para que la barra flotante no lo tape. */
const SELECTION_BAR_CLEARANCE = 76;

export function KgDataTable<Row>({
  columns,
  rows,
  rowKey,
  totalCount,
  emptyTitle,
  emptyHint,
  maxBodyHeight,
  fillHeight = false,
  footerActions,
  totalsRow,
  selection,
  sort,
}: DataTableProps<Row>) {
  if (rows.length === 0) {
    // Sin filas no hay totales que mostrar: el EmptyState es toda la respuesta.
    return <EmptyState title={emptyTitle} hint={emptyHint} />;
  }

  const total = totalCount ?? rows.length;
  const showingRange =
    total === rows.length
      ? `${fCount(total)} ${total === 1 ? "registro" : "registros"}`
      : `${fCount(rows.length)} de ${fCount(total)} registros`;

  // fillHeight gana. maxBodyHeight sigue existiendo para pages no migradas.
  const scrolls = fillHeight || maxBodyHeight != null;
  const scrollStyle: CSSProperties = fillHeight
    ? { overflow: "auto", flex: 1, minHeight: 0 }
    : maxBodyHeight
      ? { overflow: "auto", maxHeight: maxBodyHeight }
      : { overflowX: "auto" };

  const stickyThStyle: CSSProperties | undefined = scrolls
    ? {
        position: "sticky",
        top: 0,
        zIndex: 1,
        background: "var(--kg-surface-1-solid)",
      }
    : undefined;

  // El <tfoot> se pega al fondo del contenedor scrolleable: la fila de
  // totales queda siempre visible aunque el body tenga 300 filas.
  const stickyTfootStyle: CSSProperties | undefined = scrolls
    ? {
        position: "sticky",
        bottom: 0,
        zIndex: 1,
        background: "var(--kg-surface-1-solid)",
      }
    : undefined;

  const selectableIds = selection
    ? rows.filter((r) => selection.isSelectable?.(r) ?? true).map(rowKey)
    : [];
  const selectedVisibleCount = selection
    ? selectableIds.filter((id) => selection.selectedIds.has(id)).length
    : 0;
  const allVisibleSelected =
    selectableIds.length > 0 && selectedVisibleCount === selectableIds.length;
  const someVisibleSelected = !allVisibleSelected && selectedVisibleCount > 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        ...(fillHeight ? { flex: 1, minHeight: 0 } : {}),
      }}
    >
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
              {selection && (
                <th
                  scope="col"
                  style={{
                    padding: "10px 0 10px 14px",
                    borderBottom: "1px solid var(--kg-border-subtle)",
                    width: CHECK_COL_WIDTH,
                    ...stickyThStyle,
                  }}
                >
                  <input
                    type="checkbox"
                    className="kg-focus"
                    aria-label={
                      selection.headerLabel ?? "Seleccionar todos los visibles"
                    }
                    checked={allVisibleSelected}
                    ref={(el) => {
                      // `indeterminate` no es atributo: solo propiedad del DOM.
                      if (el) el.indeterminate = someVisibleSelected;
                    }}
                    onChange={(e) =>
                      selection.onToggleAll(e.target.checked, selectableIds)
                    }
                    style={{
                      accentColor: "var(--kg-accent-500)",
                      cursor: "pointer",
                    }}
                  />
                </th>
              )}
              {columns.map((c) => {
                const sortKey = c.sortKey ?? c.key;
                const isSorted = sort != null && sort.key === sortKey;
                const ariaSort =
                  sort && isSorted
                    ? sort.dir === "asc"
                      ? ("ascending" as const)
                      : ("descending" as const)
                    : undefined;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={ariaSort}
                    style={{
                      textAlign: c.align ?? "left",
                      padding: "10px 14px",
                      borderBottom: "1px solid var(--kg-border-subtle)",
                      color: isSorted ? "var(--kg-text-2)" : "var(--kg-text-3)",
                      fontWeight: 600,
                      fontSize: 11,
                      letterSpacing: 0.2,
                      textTransform: "uppercase",
                      width: c.width,
                      whiteSpace: "nowrap",
                      ...stickyThStyle,
                    }}
                  >
                    <SortableLabel
                      column={c}
                      sortKey={sortKey}
                      sort={sort}
                      isSorted={isSorted}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const id = rowKey(row);
              const selectable = selection
                ? (selection.isSelectable?.(row) ?? true)
                : false;
              const isSelected = selection
                ? selection.selectedIds.has(id)
                : false;
              return (
                <tr
                  key={id}
                  // Con la fila seleccionada el hover deja de aportar: el halo
                  // ya la distingue y el `kg-row:hover` la apagaría.
                  className={isSelected ? undefined : "kg-row"}
                  style={{
                    borderBottom: "1px solid var(--kg-border-subtle)",
                    // Halo de acento, no tono semántico: estar seleccionada es
                    // un modo de la UI, no un estado del dato.
                    ...(isSelected
                      ? { background: "var(--kg-accent-halo)" }
                      : {}),
                  }}
                >
                  {selection && (
                    <td style={{ padding: "10px 0 10px 14px" }}>
                      {selectable && (
                        <input
                          type="checkbox"
                          className="kg-focus"
                          aria-label={
                            selection.rowLabel?.(row) ?? "Seleccionar fila"
                          }
                          checked={isSelected}
                          onChange={(e) =>
                            selection.onToggleRow(id, e.target.checked, row)
                          }
                          style={{
                            accentColor: "var(--kg-accent-500)",
                            cursor: "pointer",
                          }}
                        />
                      )}
                    </td>
                  )}
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={c.numeric ? "kg-num" : undefined}
                      style={{
                        textAlign: c.align ?? "left",
                        padding: "10px 14px",
                        color: "var(--kg-text-1)",
                        fontVariantNumeric: c.numeric
                          ? "tabular-nums"
                          : undefined,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          {totalsRow && (
            <TotalsFooter
              columns={columns}
              totalsRow={totalsRow}
              hasSelectionColumn={selection != null}
              stickyStyle={stickyTfootStyle}
            />
          )}
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
          // No encogerse cuando el body flex-fill agarra todo el espacio.
          flexShrink: 0,
        }}
      >
        <span>{showingRange}</span>
        {footerActions}
      </div>
      {selectedVisibleCount > 0 && (
        // Hueco para la KgSelectionBar (fixed al fondo del viewport). Sin esto
        // la barra tapa el footer en 390px. Con `fillHeight` el hueco empuja
        // el footer hacia arriba y el body scrolleable absorbe la diferencia.
        <div
          aria-hidden
          style={{ height: SELECTION_BAR_CLEARANCE, flexShrink: 0 }}
        />
      )}
    </div>
  );
}

// ─── Header ordenable ──────────────────────────────────────────────────────

function SortableLabel<Row>({
  column,
  sortKey,
  sort,
  isSorted,
}: {
  readonly column: Column<Row>;
  readonly sortKey: string;
  readonly sort: DataTableSort | undefined;
  readonly isSorted: boolean;
}) {
  if (!column.sortable || !sort || (!sort.onChange && !sort.hrefFor)) {
    return <>{column.label}</>;
  }

  const dir = nextSortDir(sort, sortKey);
  const arrow = isSorted ? (sort.dir === "asc" ? "↑" : "↓") : "↕";
  const inner = (
    <>
      {column.label}
      <span aria-hidden style={{ opacity: isSorted ? 1 : 0.35, fontSize: 10 }}>
        {arrow}
      </span>
    </>
  );
  // Hereda tipografía y color del <th> para que ordenable y no-ordenable se
  // vean idénticos hasta que se los toca.
  const trigger: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    font: "inherit",
    color: "inherit",
    letterSpacing: "inherit",
    textTransform: "inherit",
    background: "none",
    border: "none",
    padding: 0,
    margin: 0,
    cursor: "pointer",
    textDecoration: "none",
  };

  if (sort.onChange) {
    const onChange = sort.onChange;
    return (
      <button
        type="button"
        className="kg-focus"
        onClick={() => onChange(sortKey, dir)}
        style={trigger}
      >
        {inner}
      </button>
    );
  }
  return (
    <Link
      href={sort.hrefFor?.(sortKey, dir) ?? "#"}
      scroll={false}
      className="kg-focus"
      style={trigger}
    >
      {inner}
    </Link>
  );
}

// ─── Fila de totales ───────────────────────────────────────────────────────

function TotalsFooter<Row>({
  columns,
  totalsRow,
  hasSelectionColumn,
  stickyStyle,
}: {
  readonly columns: ReadonlyArray<Column<Row>>;
  readonly totalsRow: TotalsRow;
  readonly hasSelectionColumn: boolean;
  readonly stickyStyle: CSSProperties | undefined;
}) {
  const labelSpan = Math.min(
    Math.max(1, totalsRow.labelSpan ?? 1),
    columns.length,
  );
  const valueColumns = columns.slice(labelSpan);
  const base: CSSProperties = {
    padding: "10px 14px",
    borderTop: "1px solid var(--kg-border-default)",
    color: "var(--kg-text-1)",
    fontWeight: 700,
    whiteSpace: "nowrap",
    ...stickyStyle,
  };

  return (
    <tfoot>
      <tr>
        <th
          scope="row"
          colSpan={labelSpan + (hasSelectionColumn ? 1 : 0)}
          style={{ ...base, textAlign: "left" }}
        >
          {totalsRow.label}
        </th>
        {valueColumns.map((c) => (
          <td
            key={c.key}
            className={c.numeric ? "kg-num" : undefined}
            style={{
              ...base,
              textAlign: c.align ?? "left",
              fontVariantNumeric: c.numeric ? "tabular-nums" : undefined,
            }}
          >
            {totalsRow.cells[c.key] ?? null}
          </td>
        ))}
      </tr>
    </tfoot>
  );
}

// ─── Barra flotante de acciones masivas ────────────────────────────────────

/**
 * Barra de bulk actions. Presentación pura (sin hooks, sin estado): el caller
 * la monta cuando hay seleccionados y le pasa los controles como children —
 * en `leads-table` son 2 botones + 2 selects, en `cobros-view` un select de
 * producto. Acá no se decide QUÉ acciones hay; solo dónde y cómo se ven.
 *
 * Es `fixed` al fondo del viewport y no `sticky` dentro del panel (como hoy
 * en leads) porque con `fillHeight` el panel scrollea internamente y una
 * barra sticky quedaría enterrada dentro de ese scroll. Respeta
 * `env(safe-area-inset-bottom)` para no caer bajo la barra de gestos de iOS,
 * y `KgDataTable` reserva el hueco equivalente para que el footer
 * "N registros" no quede tapado en mobile.
 *
 * zIndex 900: sobre el contenido, debajo de Drawer/BottomSheet (2000) — si se
 * abre un drawer estando la selección activa, el drawer manda.
 */
// `KgSelectionBar` se mudó a `selection-bar.tsx`: necesita `createPortal`
// (y por lo tanto `"use client"`) para escapar del `backdrop-filter` de
// `.kg-glass`, que en tema oscuro convertía a cualquier Panel ancestro en
// containing block y despegaba la barra del viewport. Se re-exporta acá para
// que los consumidores la sigan importando junto a la tabla.
export { KgSelectionBar } from "./selection-bar";
