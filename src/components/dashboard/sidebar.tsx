import type { SessionProfile } from "@/lib/supabase/auth";

import { NavGroup } from "./nav-group";
import { NavLink } from "./nav-link";

/**
 * Sidebar links are cosmetic — RLS is the real gate on what each user can
 * reach. We hide entries here so the UI doesn't dangle dead links:
 *   - Calculadora: visible para todos los roles (decisión 2026-06-09).
 *   - Equipo / Leads (CRM Fase 4): ocultos para cliente. La page.tsx también
 *     hace bounce — esto evita el link colgado.
 *   - Admin section: solo superadmin.
 *
 * Audit log: ruta sigue existiendo (`/proyectos/[id]/audit`) pero la sacamos
 * del sidebar — accesible solo via URL directa cuando el equipo lo necesite.
 */
export function Sidebar({ profile }: { readonly profile: SessionProfile }) {
  const showAdmin = profile.role === "superadmin" || profile.role === "dev";
  const showCrm = profile.role !== "cliente";
  // Comisiones es admin-only (modalidades + reglas son decisión de admin).
  const showCommissions =
    profile.role === "superadmin" ||
    profile.role === "admin" ||
    profile.role === "dev";

  return (
    <aside className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-bg-elevated px-4 py-6">
      <div className="mb-8 px-2">
        <span className="text-base font-bold text-accent">Launch OS</span>
      </div>

      <nav className="space-y-1">
        <NavLink scopedSuffix="" exact>
          Overview
        </NavLink>
        <NavLink scopedSuffix="/launches">Lanzamientos</NavLink>
        {showCrm && (
          <NavLink scopedSuffix="/analitica">Analítica</NavLink>
        )}
        {showCrm && (
          <NavGroup
            label="Ventas"
            scopedSuffixes={[
              "/leads",
              "/equipo",
              "/leaderboard",
              ...(showCommissions ? ["/comisiones"] : []),
            ]}
          >
            <NavLink scopedSuffix="/leads">Leads</NavLink>
            <NavLink scopedSuffix="/equipo">Equipo</NavLink>
            <NavLink scopedSuffix="/leaderboard">Leaderboard</NavLink>
            {showCommissions && (
              <NavLink scopedSuffix="/comisiones">Comisiones</NavLink>
            )}
          </NavGroup>
        )}
        <NavLink href="/calculadora">Calculadora</NavLink>
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
