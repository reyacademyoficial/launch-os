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
            ...(showCommissions ? ["/comisiones"] : []),
          ]}
        >
          {/*
            "Equipo" y "Ranking" salieron en 6d-C1: ambos son cross-proyecto
            y se administran desde /comercial/equipo (ranking migra en C2).
            Comisiones sigue provisionalmente acá hasta 6d-C2.
          */}
          <NavLink scopedSuffix="/ventas">Ventas</NavLink>
          {showCommissions && (
            <NavLink scopedSuffix="/comisiones">Comisiones</NavLink>
          )}
        </NavGroup>
        <NavGroup
          label="Admin y finanzas"
          scopedSuffixes={["/cobros"]}
        >
          {/*
            "Bancos" y "Métodos de pago" salieron en 6d-A/B, "Productos" en
            6d-C1: todos viven en Kingrow. Solo queda Cobros — es operación
            del lanzamiento, no configuración administrativa.
          */}
          <NavLink scopedSuffix="/cobros">Cobros</NavLink>
        </NavGroup>
      </nav>
    </aside>
  );
}
