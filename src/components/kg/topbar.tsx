"use client";

import { usePathname } from "next/navigation";

import { NotificationBell } from "@/components/notifications/notification-bell";
import type { Theme } from "@/lib/theme";

import { SidebarToggle } from "../dashboard/sidebar-toggle";
import { resolveActive } from "./layers";
import { SidebarCollapseToggle } from "./sidebar-collapse-toggle";
import { KgThemeToggle } from "./theme-toggle";

/**
 * KG · Topbar. A la izquierda: hamburger mobile + "Capa X" en micro-uppercase
 * arriba del título del módulo, más el toggle de colapso de sidebar (sólo
 * desktop, ver `SidebarCollapseToggle`). A la derecha: theme toggle + bell. Sin
 * contadores de alerta ni "críticas" en 6a — se suman en 6b+ cuando cada
 * módulo tenga datos.
 *
 * El botón de filtros NO vive acá: se movió al ContextBar de cada página
 * (`ContextBarFiltersButton`) para que quede junto al contexto de la vista
 * y no compita con el bell + theme toggle a la derecha.
 *
 * Las tabs del módulo tampoco viven acá — se renderizan como franja aparte
 * abajo del header vía `KgModuleNav` en el layout de cada módulo. Un intento
 * previo de mergear todo en el topbar quedó visualmente pesado.
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
      className="kg-glass-2 flex items-center gap-3 border-b px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:px-6"
      style={{ borderColor: "var(--kg-border-subtle)" }}
    >
      <SidebarToggle />
      <SidebarCollapseToggle />
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
    </header>
  );
}
