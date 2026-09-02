"use client";

import { usePathname } from "next/navigation";

import { KgModuleNav } from "./module-nav";
import {
  KgProjectSwitcher,
  type ProjectSwitcherItem,
} from "./project-switcher";
import type { TabItem } from "./tabs-bar";

/**
 * KG · Nav del módulo Lanzamientos scopeado a un proyecto.
 *
 * Reemplaza a la sidebar del viejo `ProjectShell`: las rutas del proyecto
 * pasaron de ser ítems de una sidebar propia a ser pestañas de módulo, igual
 * que Financiero. La sidebar Kingrow queda visible siempre.
 *
 * Fila única: switcher de proyecto + tabs. En mobile se apilan (el switcher
 * a ancho completo arriba, el carrusel de tabs abajo); en `md+` van en línea.
 *
 * AUTO-OCULTADO en el detalle de un lanzamiento
 * ---------------------------------------------
 * Dentro de `/proyectos/<id>/launches/<launchId>/*` el nav manda es el del
 * lanzamiento (breadcrumb "← Lanzamientos" + tabs KPI/Presupuesto/…), que
 * renderiza el layout del launch. Dos filas de tabs apiladas se comían la
 * pantalla en mobile, así que acá devolvemos `null` y dejamos una sola.
 *
 * El listado `/launches` (sin launchId) SÍ muestra este nav — el regex exige
 * un segmento después de `launches`.
 */
const LAUNCH_DETAIL = /^\/proyectos\/[^/]+\/launches\/[^/]+/;

export function KgProjectNav({
  items,
  projects,
  activeId,
  activeName,
}: {
  readonly items: readonly TabItem[];
  readonly projects: readonly ProjectSwitcherItem[];
  readonly activeId: string;
  readonly activeName: string;
}) {
  const pathname = usePathname();
  if (LAUNCH_DETAIL.test(pathname)) return null;

  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
      <KgProjectSwitcher
        projects={projects}
        activeId={activeId}
        activeName={activeName}
      />
      <div className="min-w-0 md:flex-1">
        <KgModuleNav items={items} />
      </div>
    </div>
  );
}
