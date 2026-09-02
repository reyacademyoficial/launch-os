import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

/**
 * KG · TabsBar (vista). La mitad PRESENTACIONAL de la barra de pestañas:
 * recibe cuál está activa, no la deduce.
 *
 * POR QUÉ ESTÁ SEPARADA DE `tabs-bar.tsx`
 * `KgTabsBar` resuelve la pestaña activa con `usePathname()`, así que es un
 * client component. Eso sirve cuando cada pestaña es una RUTA (Financiero,
 * el detalle de un lanzamiento), pero no cuando son valores de un query param
 * sobre el mismo pathname — como las 4 vistas de Analítica (`?view=`): el
 * matcher por prefijo marcaría siempre la misma, y en cuanto hubiera un
 * filtro en la URL no marcaría ninguna.
 *
 * Antes de existir este archivo, Analítica se había copiado el contrato
 * visual a mano. Duplicar los estilos del design system en una page es
 * exactamente la deriva que estamos sacando del módulo, así que la barra se
 * partió en dos: acá el markup, y en `tabs-bar.tsx` el resolvedor por
 * pathname que la envuelve.
 *
 * Sin `"use client"` a propósito: una page server la renderiza sin mandar un
 * byte de JS al browser. La navegación es `<Link>` puro.
 *
 * Uso desde una page server:
 *
 *   <KgTabsBarView
 *     ariaLabel="Vista de analítica"
 *     activeHref={hrefDe(vistaActual)}
 *     items={VIEWS.map((v) => ({ href: hrefDe(v), label: LABELS[v] }))}
 *   />
 */

export interface TabItem {
  readonly href: string;
  readonly label: string;
}

export const KG_TABS_NAV_STYLE: CSSProperties = {
  display: "flex",
  gap: 4,
  flexWrap: "wrap",
  padding: 6,
  borderRadius: "var(--kg-r-full)",
  background: "var(--kg-surface-2-solid)",
  border: "1px solid var(--kg-border-subtle)",
  alignSelf: "flex-start",
};

/** Estilo de una pill. Compartido por las dos variantes para que no deriven. */
function tabPillStyle(active: boolean): CSSProperties {
  return {
    padding: "6px 14px",
    minHeight: 36,
    borderRadius: 999,
    border: "none",
    background: active ? "var(--kg-accent-500)" : "transparent",
    color: active ? "#fff" : "var(--kg-text-2)",
    fontSize: 12,
    fontWeight: 700,
    textDecoration: "none",
    transition: "all var(--kg-dur) var(--kg-ease)",
    whiteSpace: "nowrap",
  };
}

export function KgTabsBarView({
  items,
  activeHref,
  ariaLabel = "Pestañas del módulo",
}: {
  readonly items: readonly TabItem[];
  /** El `href` de la pestaña activa. `null` = ninguna. */
  readonly activeHref: string | null;
  readonly ariaLabel?: string;
}) {
  return (
    <nav aria-label={ariaLabel} style={KG_TABS_NAV_STYLE} role="tablist">
      {items.map((t) => {
        const active = t.href === activeHref;
        return (
          <Link
            key={t.href}
            href={t.href}
            className="kg-focus"
            role="tab"
            aria-selected={active}
            style={tabPillStyle(active)}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export interface TabOption<V extends string = string> {
  readonly value: V;
  readonly label: ReactNode;
}

/**
 * KG · Tabs que NO navegan: eligen un valor y avisan por callback.
 *
 * POR QUÉ EXISTE APARTE DE `KgTabsBarView`
 * Esa variante renderiza `<Link>` y necesita un `href` por pestaña, lo cual
 * asume que cambiar de pestaña cambia la URL. Hay pestañas donde eso es
 * justamente lo que NO se quiere: elegir una de las ventas de un alumno
 * dentro de un `Drawer` (navegar cerraría el drawer y perdería el modo de
 * edición), o alternar sub-vistas de un componente cuyo estado es local.
 *
 * Antes de existir, esos casos se copiaban la pill del sistema a mano. Las
 * dos variantes comparten `tabPillStyle` y `KG_TABS_NAV_STYLE`, así que no
 * pueden derivar visualmente.
 *
 * Uso:
 *
 *   <KgTabsSelect
 *     ariaLabel="Ventas del alumno"
 *     value={selectedSaleId}
 *     onSelect={setSelectedSaleId}
 *     options={sales.map((s, i) => ({ value: s.id, label: `#${i + 1} · …` }))}
 *   />
 */
export function KgTabsSelect<V extends string = string>({
  options,
  value,
  onSelect,
  ariaLabel = "Pestañas",
}: {
  readonly options: readonly TabOption<V>[];
  /** El `value` activo. `null` = ninguno. */
  readonly value: V | null;
  readonly onSelect: (value: V) => void;
  readonly ariaLabel?: string;
}) {
  return (
    <nav aria-label={ariaLabel} style={KG_TABS_NAV_STYLE} role="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(o.value)}
            className="kg-focus"
            style={{ ...tabPillStyle(active), cursor: "pointer" }}
          >
            {o.label}
          </button>
        );
      })}
    </nav>
  );
}
