"use client";

import { IconFilter } from "./icons";
import { usePageMenuActions, usePageMenuState } from "./page-menu";

/**
 * Botón "Filtros" — visible en TODOS los breakpoints (antes era mobile-only).
 * Vive dentro del `ContextBar` porque es el ancla visual de "qué estoy
 * viendo" — el botón queda obvio y no compite con el bell + theme toggle en
 * la esquina superior derecha.
 *
 * Muestra un badge con la cantidad total de filtros activos (sumado de todos
 * los grupos registrados vía `<KgPageFilters>`). Se auto-oculta cuando la
 * página no registró ningún grupo.
 */
export function ContextBarFiltersButton() {
  const { filterGroups } = usePageMenuState();
  const { openSheet } = usePageMenuActions();
  if (filterGroups.length === 0) return null;

  const activeCount = filterGroups.reduce((sum, g) => sum + g.activeCount, 0);
  const hasActive = activeCount > 0;

  return (
    <button
      type="button"
      onClick={openSheet}
      aria-label={
        hasActive
          ? `Abrir filtros (${activeCount} activo${activeCount === 1 ? "" : "s"})`
          : "Abrir filtros"
      }
      className="kg-focus inline-flex items-center"
      style={{
        gap: 6,
        padding: "6px 10px",
        borderRadius: 999,
        background: hasActive
          ? "var(--kg-accent-500)"
          : "var(--kg-surface-2-solid)",
        border: `1px solid ${hasActive ? "var(--kg-accent-500)" : "var(--kg-border-subtle)"}`,
        color: hasActive ? "#fff" : "var(--kg-text-1)",
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
      }}
    >
      <IconFilter size={14} />
      <span>Filtros</span>
      {hasActive && (
        <span
          aria-hidden
          style={{
            minWidth: 18,
            height: 18,
            padding: "0 5px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.25)",
            color: "#fff",
            fontSize: 10,
            fontWeight: 800,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {activeCount}
        </span>
      )}
    </button>
  );
}
