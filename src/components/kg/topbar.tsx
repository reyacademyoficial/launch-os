"use client";

import { usePathname } from "next/navigation";

import { NotificationBell } from "@/components/notifications/notification-bell";
import type { Theme } from "@/lib/theme";

import { SidebarToggle } from "../dashboard/sidebar-toggle";
import { IconFilter } from "./icons";
import { resolveActive } from "./layers";
import { usePageMenuActions, usePageMenuState } from "./page-menu";
import { KgThemeToggle } from "./theme-toggle";

/**
 * KG · Topbar. A la izquierda: hamburger mobile + "Capa X" en micro-uppercase
 * arriba del título del módulo. A la derecha: theme toggle (segmented). Sin
 * contadores de alerta ni "críticas" en 6a — se suman en 6b+ cuando cada
 * módulo tenga datos.
 *
 * Client component porque necesita usePathname() para decidir el título del
 * módulo activo. resolveActive() vive en layers.ts y aplica el mismo criterio
 * que el highlight del sidebar.
 */
export function KgTopbar({ theme }: { readonly theme: Theme }) {
  const pathname = usePathname();
  const active = resolveActive(pathname);
  const layerLabel = active?.layerLabel ?? "Sistema";
  const moduleLabel = active?.module.label ?? "Kingrow";

  return (
    <header
      className="kg-glass-2 flex items-center gap-3 border-b px-4 py-3 sm:px-6"
      style={{ borderColor: "var(--kg-border-subtle)" }}
    >
      <SidebarToggle />
      <div className="min-w-0">
        <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
          Capa {layerLabel}
        </div>
        <div className="kg-t4 truncate" style={{ color: "var(--kg-text-1)" }}>
          {moduleLabel}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <FiltersButton />
        <NotificationBell />
        <KgThemeToggle theme={theme} />
      </div>
    </header>
  );
}

/**
 * Botón "Filtros" — mobile-only. Solo aparece cuando la página en curso
 * registró un nodo de filtros con `useRegisterPageFilters`. Abre el
 * `PageMenuSheet` de la shell.
 */
function FiltersButton() {
  const { filterGroups } = usePageMenuState();
  const { openSheet } = usePageMenuActions();
  if (filterGroups.length === 0) return null;
  return (
    <button
      type="button"
      onClick={openSheet}
      aria-label="Abrir filtros"
      className="kg-focus md:hidden"
      style={{
        display: "inline-flex",
        alignItems: "center",
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
