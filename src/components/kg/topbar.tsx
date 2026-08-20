"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NotificationBell } from "@/components/notifications/notification-bell";
import type { Theme } from "@/lib/theme";

import { SidebarToggle } from "../dashboard/sidebar-toggle";
import { resolveActive } from "./layers";
import { usePageMenuState, type ModuleTabItem } from "./page-menu";
import { KgThemeToggle } from "./theme-toggle";

/**
 * KG · Topbar.
 *   Fila 1: hamburger mobile · "Capa X" + título del módulo · bell · theme.
 *   Fila 2: tabs del módulo activo (Dashboard, Proyectos, …). Se registran
 *           desde el layout de cada módulo vía `KgModuleNav` y aparecen acá
 *           sin ocupar una franja separada — libera vertical para la tabla.
 *
 * El botón de filtros mobile+desktop NO vive acá: está en el `ContextBar`
 * de cada página (`ContextBarFiltersButton`) para quedar junto al contexto
 * de la vista y no competir con el bell + theme toggle a la derecha.
 *
 * Client component: `usePathname` + `usePageMenuState` (context).
 */
export function KgTopbar({ theme }: { readonly theme: Theme }) {
  const pathname = usePathname();
  const active = resolveActive(pathname);
  const layerLabel = active?.layerLabel ?? "Sistema";
  const moduleLabel = active?.module.label ?? "Kingrow";

  const { moduleTabs } = usePageMenuState();

  return (
    <header
      className="kg-glass-2 border-b px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:px-6"
      style={{ borderColor: "var(--kg-border-subtle)" }}
    >
      <div className="flex items-center gap-3 pb-3">
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
          <NotificationBell />
          <KgThemeToggle theme={theme} />
        </div>
      </div>
      {moduleTabs && moduleTabs.length > 0 && (
        <ModuleTabsStrip tabs={moduleTabs} />
      )}
    </header>
  );
}

/**
 * Strip de tabs pegado abajo del título del módulo. Desktop: pills en línea
 * con wrap. Mobile: carrusel horizontal (misma UX que teníamos con la
 * franja separada, ahora dentro del header).
 */
function ModuleTabsStrip({ tabs }: { readonly tabs: readonly ModuleTabItem[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Pestañas del módulo"
      role="tablist"
      className="kg-tabs flex gap-1 overflow-x-auto pb-3 md:flex-wrap md:overflow-visible"
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      {tabs.map((t) => {
        const active = isActive(pathname, t.href, tabs);
        return (
          <Link
            key={t.href}
            href={t.href}
            className="kg-focus"
            role="tab"
            aria-selected={active}
            style={{
              flexShrink: 0,
              padding: "6px 12px",
              borderRadius: 999,
              background: active
                ? "var(--kg-accent-500)"
                : "var(--kg-surface-2-solid)",
              color: active ? "#fff" : "var(--kg-text-2)",
              border: "1px solid var(--kg-border-subtle)",
              fontSize: 12,
              fontWeight: 700,
              textDecoration: "none",
              whiteSpace: "nowrap",
              transition: "background var(--kg-dur) var(--kg-ease)",
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Item más específico gana el resaltado. */
function isActive(
  pathname: string,
  href: string,
  items: readonly ModuleTabItem[],
): boolean {
  const matches = items.filter(
    (t) => pathname === t.href || pathname.startsWith(`${t.href}/`),
  );
  if (matches.length === 0) return false;
  const winner = matches.reduce((a, b) =>
    b.href.length > a.href.length ? b : a,
  );
  return winner.href === href;
}
