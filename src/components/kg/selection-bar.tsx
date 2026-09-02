"use client";

import { createPortal } from "react-dom";
import type { ReactNode } from "react";

import { fCount } from "@/lib/finance/format";

/**
 * KG · Barra flotante de acciones masivas. Aparece anclada al fondo del
 * viewport cuando hay filas seleccionadas en una `KgDataTable`.
 *
 * POR QUÉ SE PORTALEA A `document.body`
 * La barra es `position: fixed`, pero eso NO alcanza para anclarla al
 * viewport: cualquier ancestro con `backdrop-filter` se convierte en
 * *containing block* de sus descendientes `fixed` (spec de CSS Containment).
 * `.kg-glass` aplica `backdrop-filter: blur(20px)` en tema oscuro — en claro
 * el token es `none` — así que una tabla dentro de un `Panel` rompía la barra
 * SOLO en dark, y encima el `overflow: hidden` del Panel la recortaba.
 *
 * Un bug que aparece en un solo tema es de los peores de encontrar, así que
 * la primitiva se hace cargo: portalea a `body` y ningún consumidor tiene que
 * saber que esto existe. Lo descubrió la migración de la tabla de leads.
 *
 * SSR: `createPortal` necesita `document`. Se guarda con un chequeo directo en
 * vez de un `mounted` con `useEffect` (que violaría
 * `react-hooks/set-state-in-effect`). No hay mismatch de hidratación posible
 * porque la selección siempre arranca vacía: en el primer render `count` es 0
 * y el componente devuelve `null` en los dos lados.
 *
 * Uso:
 *
 *   <KgSelectionBar count={selectedIds.size} onClear={() => setSelected(new Set())}>
 *     <select style={smallBtn} onChange={…}>…asignar producto…</select>
 *   </KgSelectionBar>
 */
export function KgSelectionBar({
  count,
  onClear,
  children,
  noun = "seleccionados",
  message,
}: {
  readonly count: number;
  readonly onClear?: () => void;
  readonly children?: ReactNode;
  /** Sustantivo en plural: "seleccionados", "ventas", "leads". */
  readonly noun?: string;
  /** Feedback de la última acción ("Estado actualizado: 12"). */
  readonly message?: ReactNode;
}) {
  if (count <= 0) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="region"
      aria-label="Acciones masivas"
      className="kg-glass"
      style={{
        position: "fixed",
        left: 12,
        right: 12,
        bottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
        margin: "0 auto",
        maxWidth: 760,
        zIndex: 900,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
        padding: "10px 12px",
        borderRadius: "var(--kg-r-16)",
        borderColor: "var(--kg-border-accent)",
        boxShadow: "var(--kg-shadow-float)",
      }}
    >
      <span
        aria-live="polite"
        style={{
          color: "var(--kg-text-1)",
          fontSize: 12,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {fCount(count)} {noun}
      </span>
      {children}
      {message && (
        <span style={{ color: "var(--kg-text-3)", fontSize: 11 }}>
          {message}
        </span>
      )}
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="kg-focus"
          style={{
            marginLeft: "auto",
            padding: "5px 12px",
            borderRadius: 999,
            background: "transparent",
            border: "1px solid var(--kg-border-subtle)",
            color: "var(--kg-text-2)",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Limpiar
        </button>
      )}
    </div>,
    document.body,
  );
}
