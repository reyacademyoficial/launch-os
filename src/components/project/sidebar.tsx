import type { SessionProfile } from "@/lib/supabase/auth";

import { NavGroup } from "../dashboard/nav-group";
import { NavLink } from "../dashboard/nav-link";

/**
 * ProjectShell · Sidebar scoped al proyecto activo.
 *
 * Contenido idéntico al sidebar LaunchOS actual salvo lo que ya no pertenece
 * al scope de proyecto: Calculadora y Admin viven en el KingrowShell (fuera
 * del proyecto), acá quedan solo las rutas que operan sobre `/proyectos/[id]`.
 *
 * Regla dura: cliente NO llega acá — el gate de (app)/layout.tsx redirige a
 * /portal. Por eso no defiendo con `showCrm` como lo hacía el sidebar viejo:
 * en este shell no hay clientes por construcción.
 */
export function ProjectSidebar({ profile: _profile }: { readonly profile: SessionProfile }) {
  return (
    <aside
      className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-bg-elevated px-4 py-6"
    >
      <div className="mb-6 px-2">
        <span className="text-base font-bold text-accent">Launch OS</span>
        <div className="mt-0.5 text-[10px] uppercase tracking-wider text-fg-subtle">
          Vista del proyecto
        </div>
      </div>

      <nav className="space-y-1">
        <NavLink scopedSuffix="" exact>
          Overview
        </NavLink>
        <NavLink scopedSuffix="/launches">Lanzamientos</NavLink>
        <NavLink scopedSuffix="/analitica">Analítica</NavLink>
        {/*
          Post 6d-C2, LaunchOS queda como vista OPERATIVA del lanzamiento.
          Ventas y Cobros son la operación diaria. Todo lo que era
          configuración/administración (Equipo, Ranking, Comisiones,
          Productos, Métodos de pago, Bancos) vive en Kingrow.
        */}
        <NavGroup label="Ventas" scopedSuffixes={["/ventas", "/cobros"]}>
          <NavLink scopedSuffix="/ventas">Ventas</NavLink>
          <NavLink scopedSuffix="/cobros">Cobros</NavLink>
        </NavGroup>
      </nav>
    </aside>
  );
}
