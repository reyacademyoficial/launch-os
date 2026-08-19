"use client";

import { IconFilter } from "./icons";
import { usePageMenuActions, usePageMenuState } from "./page-menu";

/**
 * Botón "Filtros" — mobile-only. Vive dentro del `ContextBar` (tarjeta sticky
 * de resumen de la página) para que el usuario tenga la acción de filtrar a
 * mano en el mismo bloque que le da contexto. Solo aparece cuando la página
 * en curso registró al menos un grupo de filtros vía `useRegisterPageFilters`
 * o `<KgPageFilters>`.
 *
 * Se sacó de la topbar (donde estaba antes) porque el ContextBar es el ancla
 * visual de "qué estoy viendo" — el botón queda más obvio y no compite con
 * el bell + theme toggle en la esquina superior derecha.
 */
export function ContextBarFiltersButton() {
  const { filterGroups } = usePageMenuState();
  const { openSheet } = usePageMenuActions();
  if (filterGroups.length === 0) return null;
  return (
    <button
      type="button"
      onClick={openSheet}
      aria-label="Abrir filtros"
      // OJO: `display` NO va en el inline style porque un inline style pisa a
      // la clase `md:hidden` (los inline styles siempre ganan sobre clases).
      // El display lo maneja Tailwind: `inline-flex` en mobile, `hidden` en
      // md+ — así el botón realmente desaparece en desktop.
      className="kg-focus inline-flex items-center md:hidden"
      style={{
        gap: 6,
        padding: "6px 10px",
        borderRadius: 999,
        background: "var(--kg-surface-2-solid)",
        border: "1px solid var(--kg-border-subtle)",
        color: "var(--kg-text-1)",
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
      }}
    >
      <IconFilter size={14} />
      <span>Filtros</span>
    </button>
  );
}
