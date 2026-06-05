import type { SessionProfile } from "@/lib/supabase/auth";

import { NavLink } from "./nav-link";

export function Sidebar({ profile }: { readonly profile: SessionProfile }) {
  const showAdmin = profile.role === "superadmin";

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-bg-elevated px-4 py-6">
      <div className="mb-8 px-2">
        <span className="text-base font-bold text-accent">Launch OS</span>
      </div>

      <nav className="space-y-1">
        <NavLink scopedSuffix="" exact>
          Overview
        </NavLink>
        <NavLink scopedSuffix="/launches">Lanzamientos</NavLink>
        <NavLink href="/calculadora">Calculadora</NavLink>
        <NavLink scopedSuffix="/integraciones">Integraciones</NavLink>
        <NavLink href="/configuracion">Configuración</NavLink>
      </nav>

      {showAdmin && (
        <>
          <div className="mb-2 mt-8 px-3 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
            Admin
          </div>
          <nav className="space-y-1">
            <NavLink href="/admin/proyectos">Proyectos</NavLink>
            <NavLink href="/admin/usuarios">Usuarios</NavLink>
          </nav>
        </>
      )}
    </aside>
  );
}
