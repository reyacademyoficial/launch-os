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
export function ProjectSidebar({ profile }: { readonly profile: SessionProfile }) {
  const showCommissions =
    profile.role === "superadmin" ||
    profile.role === "admin" ||
    profile.role === "dev";
  const showProducts = showCommissions;

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
        <NavGroup
          label="Ventas"
          scopedSuffixes={[
            "/ventas",
            "/equipo",
            "/leaderboard",
            ...(showCommissions ? ["/comisiones"] : []),
          ]}
        >
          <NavLink scopedSuffix="/ventas">Ventas</NavLink>
          <NavLink scopedSuffix="/equipo">Equipo</NavLink>
          <NavLink scopedSuffix="/leaderboard">Ranking</NavLink>
          {showCommissions && (
            <NavLink scopedSuffix="/comisiones">Comisiones</NavLink>
          )}
        </NavGroup>
        <NavGroup
          label="Admin y finanzas"
          scopedSuffixes={[
            "/cobros",
            ...(showProducts ? ["/bancos", "/metodos-pago", "/productos"] : []),
          ]}
        >
          <NavLink scopedSuffix="/cobros">Cobros</NavLink>
          {showProducts && <NavLink scopedSuffix="/bancos">Bancos</NavLink>}
          {showProducts && (
            <NavLink scopedSuffix="/metodos-pago">Métodos de pago</NavLink>
          )}
          {showProducts && (
            <NavLink scopedSuffix="/productos">Productos</NavLink>
          )}
        </NavGroup>
      </nav>
    </aside>
  );
}
