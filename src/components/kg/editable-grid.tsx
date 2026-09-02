"use client";

import { useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { EmptyState } from "./empty-state";
import { ErrorBanner, primaryBtn, secondaryBtn } from "./form-primitives";
import { fCount } from "@/lib/finance/format";

/**
 * KG · EditableGrid. Matriz de NÚMEROS editables (filas × columnas de inputs),
 * no una tabla de lectura. Es la contraparte de `KgDataTable`: donde aquella
 * pinta, esta captura.
 *
 * Derivada de `consumption-panel` (grilla franja horaria × clase del
 * lanzamiento). De ese uso salen las tres decisiones grandes:
 *
 * 1) CLIENT SIEMPRE. A diferencia de `KgDataTable` — que no lleva
 *    "use client" porque hay páginas server que la renderizan — una grilla de
 *    inputs no tiene ningún sentido sin JS. Marcamos el archivo entero y
 *    listo: el borrador vive acá adentro.
 *
 * 2) BORRADOR ADENTRO, VERDAD AFUERA. `values` es la baseline (lo último
 *    confirmado por el server). La grilla mantiene su propio `draft` y avisa
 *    cada tecleo con `onChange(draft)` — consumption necesita eso porque su
 *    chart y sus métricas ("total por clase", "pico por hora") se recalculan
 *    en vivo contra las celdas, antes de guardar. El guardado es en BATCH:
 *    `onSave(draft, changes)` manda la matriz entera de una (hoy consumption
 *    serializa `{config, cells}` en un hidden input y lo postea a
 *    `saveConsumption` — el mismo payload, sin el `<form>` a mano).
 *
 * 3) DIRTY POR DIFF, NO POR FLAG. `changes` se calcula comparando draft vs
 *    baseline celda por celda (19 slots × 3 clases en el caso real: barato).
 *    Así "escribí 5 y volví a poner 3" NO queda sucio, y el contador de la
 *    toolbar dice la verdad. Para volver a limpio después de un guardado
 *    externo, el caller pasa `baselineToken` (ej. `state.updatedAt`): cuando
 *    cambia, la grilla re-adopta `values` — ajuste de estado EN RENDER, no en
 *    un `useEffect` (el repo tiene `react-hooks/set-state-in-effect` en error).
 *
 * Celda vacía ≠ 0: se guarda como ausencia (se borra la key, y si la fila
 * queda vacía se borra la fila). Es exactamente lo que hace `updateCell` en
 * consumption y lo que espera `readCell` del lado server.
 *
 * Mobile primero: la grilla scrollea horizontalmente DENTRO de su contenedor
 * (nunca hace scrollear el body) y la columna de etiquetas queda pegada a la
 * izquierda para no perder la referencia de fila a 390px.
 *
 * La plata no se pinta acá tampoco: los totales de fila/columna van en
 * `--kg-text-1` con tabular-nums. Si un total necesita señal de estado, el
 * caller la pone al lado con un StateDot, no sobre el número.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * EJEMPLO REAL — `consumption-panel` (franjas horarias × clases)
 * ───────────────────────────────────────────────────────────────────────────
 *
 *   const hourSlots = useMemo(() => buildHourSlots(config), [config]);
 *   const [cells, setCells] = useState<ConsumptionCells>(initialState.cells);
 *
 *   <KgEditableGrid
 *     rowHeader="Hora"
 *     rows={hourSlots.map((h) => ({ key: h, label: h }))}
 *     columns={config.classes.map((c) => ({ key: c, label: c }))}
 *     values={cells}
 *     baselineToken={initialState.updatedAt}
 *     readOnly={readOnly}
 *     readOnlyReason={readOnlyReason ?? undefined}
 *     emptyTitle="Config inválida"
 *     emptyHint="La ventana horaria no genera ningún slot."
 *     cellAriaLabel={(row, col) => `${col.key} a las ${row.key}`}
 *     showRowTotals
 *     showColumnTotals
 *     onChange={setCells}
 *     onSave={async (draft) => {
 *       const fd = new FormData();
 *       fd.set("payload", JSON.stringify({ config, cells: draft }));
 *       const res = await saveConsumption(null, fd);
 *       return res && "error" in res ? { error: res.error } : { ok: true };
 *     }}
 *     onDiscard={() => setConfig(initialState.config)}
 *   />
 *
 * NO cubierto por esta primitiva (queda del lado del caller, a propósito):
 *   - el editor de CONFIG (hora inicio/fin, intervalo, agregar/renombrar/
 *     quitar clase). Filas y columnas son props: quién las define y cómo se
 *     reindexan las celdas al renombrar una clase es problema del dominio.
 *   - las cards de métricas y el chart comparativo: acá solo hay totales por
 *     fila y por columna, que es la métrica que la grilla puede derivar sola.
 */

/** Matriz dispersa: fila → columna → número. Ausente = celda vacía. */
export type KgGridValues = Readonly<Record<string, Readonly<Record<string, number>>>>;

/** Eje de la grilla (una fila o una columna). */
export interface KgGridAxis {
  /** Identidad y key del valor dentro de `KgGridValues`. */
  readonly key: string;
  /** Texto visible. Default: la key. */
  readonly label?: ReactNode;
  /** Ancho del input de esa columna (CSS). Ignorado en filas. */
  readonly width?: string;
}

/** Una celda que difiere de la baseline. `null` = vaciada. */
export interface KgGridChange {
  readonly rowKey: string;
  readonly colKey: string;
  readonly from: number | null;
  readonly to: number | null;
}

/** Resultado del guardado batch. Mismo shape que las server actions del repo. */
export type KgGridSaveResult = { readonly ok: true } | { readonly error: string };

export interface EditableGridProps {
  readonly rows: ReadonlyArray<KgGridAxis>;
  readonly columns: ReadonlyArray<KgGridAxis>;
  /** Baseline confirmada por el server. La grilla NO la muta. */
  readonly values: KgGridValues;
  /**
   * Cambia cuando el server confirma un guardado (ej. `updatedAt`). Al
   * cambiar, la grilla re-adopta `values` y vuelve a estado limpio.
   */
  readonly baselineToken?: string | number | null;
  /** Se dispara en cada tecleo con el borrador COMPLETO. */
  readonly onChange?: (draft: KgGridValues) => void;
  /**
   * Guardado en batch. Recibe el borrador entero + el diff. Si devuelve
   * `{ error }` se muestra el banner y el borrador queda sucio; si devuelve
   * `{ ok: true }` (o nada) la baseline pasa a ser el borrador.
   */
  readonly onSave?: (
    draft: KgGridValues,
    changes: ReadonlyArray<KgGridChange>,
  ) => Promise<KgGridSaveResult | void>;
  /** Se llama DESPUÉS de descartar (la grilla ya volvió a la baseline). */
  readonly onDiscard?: () => void;
  readonly readOnly?: boolean;
  readonly readOnlyReason?: string;
  /** Encabezado de la columna de etiquetas. Default: "". */
  readonly rowHeader?: ReactNode;
  readonly min?: number;
  readonly max?: number;
  /** Decimales admitidos. 0 (default) = enteros, como consumption. */
  readonly decimals?: number;
  /** Columna extra a la derecha con la suma de cada fila. */
  readonly showRowTotals?: boolean;
  /** Fila extra al pie con la suma de cada columna. */
  readonly showColumnTotals?: boolean;
  readonly rowTotalsLabel?: string;
  readonly columnTotalsLabel?: string;
  /** aria-label de cada input. Default: "<columna> · <fila>". */
  readonly cellAriaLabel?: (row: KgGridAxis, col: KgGridAxis) => string;
  readonly emptyTitle: string;
  readonly emptyHint?: string;
  readonly saveLabel?: string;
  /** Alto máximo del cuerpo scrolleable (ej. "60vh"). Sin esto crece a lo alto. */
  readonly maxBodyHeight?: string;
}

// ─── Lectura / escritura de la matriz ──────────────────────────────────────

export function readGridCell(
  values: KgGridValues,
  rowKey: string,
  colKey: string,
): number | null {
  const row = values[rowKey];
  if (!row) return null;
  const raw = row[colKey];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

/**
 * Devuelve una matriz NUEVA con la celda escrita. `null` borra la celda (y la
 * fila si queda vacía) — la ausencia es el "sin dato" del modelo, distinto de 0.
 */
export function writeGridCell(
  values: KgGridValues,
  rowKey: string,
  colKey: string,
  value: number | null,
): KgGridValues {
  const row: Record<string, number> = { ...(values[rowKey] ?? {}) };
  if (value === null) delete row[colKey];
  else row[colKey] = value;

  const next: Record<string, Readonly<Record<string, number>>> = { ...values };
  if (Object.keys(row).length === 0) delete next[rowKey];
  else next[rowKey] = row;
  return next;
}

function diffGrid(
  baseline: KgGridValues,
  draft: KgGridValues,
  rows: ReadonlyArray<KgGridAxis>,
  columns: ReadonlyArray<KgGridAxis>,
): ReadonlyArray<KgGridChange> {
  const out: KgGridChange[] = [];
  for (const r of rows) {
    for (const c of columns) {
      const from = readGridCell(baseline, r.key, c.key);
      const to = readGridCell(draft, r.key, c.key);
      if (from !== to) out.push({ rowKey: r.key, colKey: c.key, from, to });
    }
  }
  return out;
}

/**
 * Normaliza el retorno de `onSave`. Se toma `unknown` a propósito: las server
 * actions del repo devuelven `{ ok } | { error }` pero también `void` o `null`
 * según el módulo, y así el caller no tiene que castear nada.
 */
function saveErrorOf(result: unknown): string | null {
  if (result && typeof result === "object" && "error" in result) {
    const raw = (result as { readonly error?: unknown }).error;
    if (typeof raw === "string" && raw.length > 0) return raw;
    return "No se pudo guardar la grilla.";
  }
  return null;
}

function parseCell(
  raw: string,
  opts: { min?: number; max?: number; decimals: number },
): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const factor = 10 ** opts.decimals;
  let v = Math.round(n * factor) / factor;
  if (opts.min !== undefined && v < opts.min) v = opts.min;
  if (opts.max !== undefined && v > opts.max) v = opts.max;
  return v;
}

// ─── Componente ────────────────────────────────────────────────────────────

const cellInputStyle: CSSProperties = {
  width: "100%",
  minWidth: 64,
  padding: "6px 8px",
  borderRadius: "var(--kg-r-8)",
  background: "var(--kg-surface-2-solid)",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-1)",
  fontSize: 12.5,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

export function KgEditableGrid({
  rows,
  columns,
  values,
  baselineToken,
  onChange,
  onSave,
  onDiscard,
  readOnly = false,
  readOnlyReason,
  rowHeader = "",
  min = 0,
  max,
  decimals = 0,
  showRowTotals = false,
  showColumnTotals = false,
  rowTotalsLabel = "Total",
  columnTotalsLabel = "Total",
  cellAriaLabel,
  emptyTitle,
  emptyHint,
  saveLabel = "Guardar",
  maxBodyHeight,
}: EditableGridProps) {
  const [baseline, setBaseline] = useState<KgGridValues>(values);
  const [draft, setDraft] = useState<KgGridValues>(values);
  const [token, setToken] = useState<string | number | null | undefined>(
    baselineToken,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  /**
   * Texto crudo de la celda que se está tecleando. Sin esto, un input
   * controlado por el número parseado se come los estados intermedios
   * ("0." vuelve a "0", "007" a "7") y escribir decimales es imposible.
   * Solo dura mientras la celda tiene el foco.
   */
  const [editing, setEditing] = useState<{
    readonly cell: string;
    readonly raw: string;
  } | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  // Ajuste de estado en RENDER (no en useEffect — ver cabecera). Cuando el
  // server confirma un guardado el caller cambia `baselineToken` y la grilla
  // re-adopta lo que vino del server como nueva verdad.
  if (token !== baselineToken) {
    setToken(baselineToken);
    setBaseline(values);
    setDraft(values);
    setEditing(null);
    setSavedFlash(false);
    setError(null);
  }

  const changes = useMemo(
    () => diffGrid(baseline, draft, rows, columns),
    [baseline, draft, rows, columns],
  );
  const dirty = changes.length > 0;

  const columnTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of columns) {
      let sum = 0;
      for (const r of rows) sum += readGridCell(draft, r.key, c.key) ?? 0;
      map.set(c.key, sum);
    }
    return map;
  }, [draft, rows, columns]);

  const rowTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      let sum = 0;
      for (const c of columns) sum += readGridCell(draft, r.key, c.key) ?? 0;
      map.set(r.key, sum);
    }
    return map;
  }, [draft, rows, columns]);

  const grandTotal = useMemo(() => {
    let sum = 0;
    for (const v of columnTotals.values()) sum += v;
    return sum;
  }, [columnTotals]);

  const disabled = readOnly || pending;

  function commit(rowKey: string, colKey: string, raw: string) {
    const next = writeGridCell(
      draft,
      rowKey,
      colKey,
      parseCell(raw, { min, max, decimals }),
    );
    setDraft(next);
    setSavedFlash(false);
    // Se notifica en el handler, nunca desde un efecto: el chart y las
    // métricas del caller se recalculan con el mismo tecleo.
    onChange?.(next);
  }

  function handleDiscard() {
    setDraft(baseline);
    setEditing(null);
    setError(null);
    setSavedFlash(false);
    onChange?.(baseline);
    onDiscard?.();
  }

  async function handleSave() {
    if (!onSave || pending) return;
    setPending(true);
    setError(null);
    setSavedFlash(false);
    try {
      const failure = saveErrorOf(await onSave(draft, changes));
      if (failure !== null) {
        setError(failure);
      } else {
        setBaseline(draft);
        setSavedFlash(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar la grilla.");
    } finally {
      setPending(false);
    }
  }

  /**
   * Navegación vertical con flechas y Enter. Horizontal no: en un
   * `<input type="number">` las flechas laterales mueven el cursor y
   * robarlas rompe la edición.
   */
  function moveFocus(rowIndex: number, colIndex: number, delta: number) {
    const target = rowIndex + delta;
    if (target < 0 || target >= rows.length) return;
    const el = gridRef.current?.querySelector<HTMLInputElement>(
      `input[data-kg-r="${target}"][data-kg-c="${colIndex}"]`,
    );
    if (el) {
      el.focus();
      el.select();
    }
  }

  if (rows.length === 0 || columns.length === 0) {
    return <EmptyState title={emptyTitle} hint={emptyHint} />;
  }

  const headCellStyle: CSSProperties = {
    padding: "8px 10px",
    borderBottom: "1px solid var(--kg-border-subtle)",
    color: "var(--kg-text-3)",
    fontWeight: 600,
    fontSize: 11,
    letterSpacing: 0.2,
    textTransform: "uppercase",
    whiteSpace: "nowrap",
    textAlign: "left",
    ...(maxBodyHeight
      ? {
          position: "sticky",
          top: 0,
          zIndex: 2,
          background: "var(--kg-surface-1-solid)",
        }
      : {}),
  };

  // La columna de etiquetas queda pegada a la izquierda: a 390px la grilla
  // scrollea y sin esto se pierde de qué fila es cada input.
  const stickyLeft: CSSProperties = {
    position: "sticky",
    left: 0,
    zIndex: 1,
    background: "var(--kg-surface-1-solid)",
  };

  const totalCellStyle: CSSProperties = {
    padding: "8px 10px",
    borderTop: "1px solid var(--kg-border-default)",
    color: "var(--kg-text-1)",
    fontWeight: 700,
    fontSize: 12.5,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {(onSave || onDiscard) && !readOnly && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <span
            aria-live="polite"
            style={{
              color: dirty ? "var(--kg-text-2)" : "var(--kg-text-3)",
              fontSize: 11,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {pending
              ? "Guardando…"
              : dirty
                ? `${fCount(changes.length)} ${changes.length === 1 ? "celda sin guardar" : "celdas sin guardar"}`
                : savedFlash
                  ? "Grilla guardada."
                  : "Sin cambios."}
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button
              type="button"
              className="kg-focus"
              onClick={handleDiscard}
              disabled={disabled || !dirty}
              style={{ ...secondaryBtn, opacity: dirty ? 1 : 0.5 }}
            >
              Descartar
            </button>
            {onSave && (
              <button
                type="button"
                className="kg-focus"
                onClick={() => void handleSave()}
                disabled={disabled || !dirty}
                style={{ ...primaryBtn, opacity: dirty && !disabled ? 1 : 0.5 }}
              >
                {pending ? "Guardando…" : saveLabel}
              </button>
            )}
          </div>
        </div>
      )}

      {readOnlyReason && (
        <p
          className="kg-t6"
          style={{
            margin: 0,
            padding: "8px 12px",
            borderRadius: "var(--kg-r-8)",
            border: "1px solid var(--kg-border-subtle)",
            color: "var(--kg-text-3)",
          }}
        >
          {readOnlyReason}
        </p>
      )}

      {error && <ErrorBanner message={error} />}

      <div
        ref={gridRef}
        style={{
          overflow: "auto",
          ...(maxBodyHeight ? { maxHeight: maxBodyHeight } : {}),
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th
                scope="col"
                style={{
                  ...headCellStyle,
                  ...stickyLeft,
                  ...(maxBodyHeight ? { zIndex: 3 } : {}),
                }}
              >
                {rowHeader}
              </th>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  style={{ ...headCellStyle, textAlign: "right", width: c.width }}
                >
                  {c.label ?? c.key}
                </th>
              ))}
              {showRowTotals && (
                <th
                  scope="col"
                  style={{ ...headCellStyle, textAlign: "right" }}
                >
                  {rowTotalsLabel}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, rowIndex) => (
              <tr key={r.key}>
                <th
                  scope="row"
                  style={{
                    ...stickyLeft,
                    padding: "4px 10px",
                    borderBottom: "1px solid var(--kg-border-subtle)",
                    color: "var(--kg-text-2)",
                    fontSize: 12,
                    fontWeight: 600,
                    textAlign: "left",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.label ?? r.key}
                </th>
                {columns.map((c, colIndex) => {
                  const value = readGridCell(draft, r.key, c.key);
                  const cellId = `${rowIndex}:${colIndex}`;
                  const shown =
                    editing && editing.cell === cellId
                      ? editing.raw
                      : value === null
                        ? ""
                        : String(value);
                  return (
                    <td
                      key={c.key}
                      style={{
                        padding: "4px 6px",
                        borderBottom: "1px solid var(--kg-border-subtle)",
                      }}
                    >
                      <input
                        type="number"
                        inputMode={decimals > 0 ? "decimal" : "numeric"}
                        className="kg-focus kg-num"
                        data-kg-r={rowIndex}
                        data-kg-c={colIndex}
                        // Por defecto se usan las KEYS, no los labels: label es
                        // ReactNode y podría no ser texto.
                        aria-label={cellAriaLabel?.(r, c) ?? `${c.key} · ${r.key}`}
                        value={shown}
                        min={min}
                        max={max}
                        step={decimals > 0 ? 1 / 10 ** decimals : 1}
                        disabled={disabled}
                        onChange={(e) => {
                          setEditing({ cell: cellId, raw: e.target.value });
                          commit(r.key, c.key, e.target.value);
                        }}
                        onFocus={(e) => e.target.select()}
                        onBlur={() => setEditing(null)}
                        onKeyDown={(e) => {
                          if (e.key === "ArrowDown" || e.key === "Enter") {
                            e.preventDefault();
                            moveFocus(rowIndex, colIndex, 1);
                          } else if (e.key === "ArrowUp") {
                            e.preventDefault();
                            moveFocus(rowIndex, colIndex, -1);
                          }
                        }}
                        style={{
                          ...cellInputStyle,
                          opacity: disabled ? 0.6 : 1,
                        }}
                      />
                    </td>
                  );
                })}
                {showRowTotals && (
                  <td
                    className="kg-num"
                    style={{
                      padding: "4px 10px",
                      borderBottom: "1px solid var(--kg-border-subtle)",
                      textAlign: "right",
                      color: "var(--kg-text-1)",
                      fontSize: 12.5,
                      fontWeight: 600,
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {fCount(rowTotals.get(r.key) ?? 0)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          {showColumnTotals && (
            <tfoot>
              <tr>
                <th
                  scope="row"
                  style={{
                    ...totalCellStyle,
                    ...stickyLeft,
                    textAlign: "left",
                    fontSize: 11,
                    letterSpacing: 0.2,
                    textTransform: "uppercase",
                  }}
                >
                  {columnTotalsLabel}
                </th>
                {columns.map((c) => (
                  <td key={c.key} className="kg-num" style={totalCellStyle}>
                    {fCount(columnTotals.get(c.key) ?? 0)}
                  </td>
                ))}
                {showRowTotals && (
                  <td className="kg-num" style={totalCellStyle}>
                    {fCount(grandTotal)}
                  </td>
                )}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
