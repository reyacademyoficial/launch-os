import type { SessionProfile } from "@/lib/supabase/auth";

import { NavLink } from "./nav-link";

/**
 * Sidebar links are cosmetic — RLS is the real gate on what each user can
 * reach. We hide entries here so the UI doesn't dangle dead links:
 *   - Calculadora: visible para todos los roles (decisión 2026-06-09).
 *   - Audit log: oculto para operador / cliente (la policy de audit_log en
 *     0009 ya les devuelve vacío de todas formas).
 *   - Equipo / Leads (CRM Fase 4): ocultos para cliente. La page.tsx también
 *     hace bounce — esto evita el link colgado.
 *   - Admin section: solo superadmin.
 */
export function Sidebar({ profile }: { readonly profile: SessionProfile }) {
  const showAdmin = profile.role === "superadmin";
  const showAudit =
    profile.role === "superadmin" ||
    profile.role === "admin" ||
    profile.role === "analista";
  const showCrm = profile.role !== "cliente";

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
        {showCrm && <NavLink scopedSuffix="/leads">Leads</NavLink>}
        {showCrm && <NavLink scopedSuffix="/equipo">Equipo</NavLink>}
        <NavLink href="/calculadora">Calculadora</NavLink>
        <NavLink scopedSuffix="/integraciones">Integraciones</NavLink>
        {showAudit && <NavLink scopedSuffix="/audit">Audit log</NavLink>}
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
