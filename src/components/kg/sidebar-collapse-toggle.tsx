"use client";

import { useShell } from "../dashboard/shell-context";

import { IconPanelLeft } from "./icons";

/**
 * KG · Toggle de colapso de la sidebar, sólo desktop (`hidden md:flex`) —
 * abajo de `md` el que manda es el hamburger (`SidebarToggle`), que abre el
 * overlay. Pliega la sidebar para que la página use todo el ancho; útil en
 * tablas anchas y vistas de auditoría.
 *
 * La preferencia se persiste en cookie desde el ShellProvider, así que
 * sobrevive a navegación y reload sin flash. Atajo: ⌘B / Ctrl+B.
 */
export function SidebarCollapseToggle() {
  const { sidebarCollapsed, toggleSidebarCollapsed } = useShell();
  const label = sidebarCollapsed
    ? "Mostrar menú lateral"
    : "Ocultar menú lateral";

  return (
    <button
      type="button"
      onClick={toggleSidebarCollapsed}
      aria-label={label}
      aria-pressed={sidebarCollapsed}
      title={`${label} (⌘B)`}
      className="kg-focus hidden h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border transition-colors md:flex"
      style={{
        background: sidebarCollapsed
          ? "var(--kg-accent-halo)"
          : "var(--kg-surface-2-solid)",
        borderColor: "var(--kg-border-default)",
        color: sidebarCollapsed ? "var(--kg-accent-text)" : "var(--kg-text-3)",
      }}
    >
      <IconPanelLeft size={16} />
    </button>
  );
}
