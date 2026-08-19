import type { SessionProfile } from "@/lib/supabase/auth";

import { NavGroup } from "../dashboard/nav-group";
import { NavLink } from "../dashboard/nav-link";
import { KgUserBlock } from "../kg/user-block";

/**
 * ProjectShell · Sidebar scoped al proyecto activo.
 *
 * Contenido idéntico al sidebar LaunchOS actual salvo lo que ya no pertenece
 * al scope de proyecto: Calculadora y Admin viven en el KingrowShell (fuera
 * del proyecto), acá quedan solo las rutas que operan sobre `/proyectos/[id]`.
 *
 * Filtro por rol (2026-08-08):
 *   - operador  → oculto Overview y grupo Ventas. Va directo a Lanzamientos
 *     y solo ve ejecución (sin plata pactada/cobrada). Consistente con los
 *     redirects server-side en /page.tsx, /ventas y /cobros.
 *   - cliente   → ve Overview + Lanzamientos + Analítica + Ventas/Cobros
 *     (readonly, canEdit=false vía RLS). Regla nueva: cliente puede ver
 *     ventas y cobros sin editar.
 *   - resto (admin / coordinador / superadmin / dev) → ve todo.
 */
export function ProjectSidebar({ profile }: { readonly profile: SessionProfile }) {
  const isOperador = profile.role === "operador";
  return (
    <aside
      className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-bg-elevated"
    >
      <div className="px-4 pb-2 pt-6">
        <div className="px-2">
          <span className="text-base font-bold text-accent">Launch OS</span>
          <div className="mt-0.5 text-[10px] uppercase tracking-wider text-fg-subtle">
            Vista del proyecto
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-4 pb-4 pt-4">
        {!isOperador && (
          <NavLink scopedSuffix="" exact>
            Overview
          </NavLink>
        )}
        <NavLink scopedSuffix="/launches">Lanzamientos</NavLink>
        <NavLink scopedSuffix="/analitica">Analítica</NavLink>
        {/*
          Post 6d-C2, LaunchOS queda como vista OPERATIVA del lanzamiento.
          Ventas y Cobros son la operación diaria. Todo lo que era
          configuración/administración (Equipo, Ranking, Comisiones,
          Productos, Métodos de pago, Bancos) vive en Kingrow.
        */}
        {!isOperador && (
          <NavGroup label="Ventas" scopedSuffixes={["/ventas", "/cobros"]}>
            <NavLink scopedSuffix="/ventas">Ventas</NavLink>
            <NavLink scopedSuffix="/cobros">Cobros</NavLink>
          </NavGroup>
        )}
        {/* Calculadora — herramienta transversal, accede desde el contexto de proyecto */}
        <NavLink href="/calculadora">Calculadora</NavLink>
      </nav>

      <div className="border-t border-border px-3 py-3">
        <KgUserBlock profile={profile} />
      </div>
    </aside>
  );
}
