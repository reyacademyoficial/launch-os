import { ClientNavLink } from "./client-nav-link";

/**
 * Sidebar del portal del cliente. Frontera dura:
 *   - Sin Equipo, Leaderboard, Comisiones, Integraciones, Admin, Auditoría.
 *   - Solo lo que el rol cliente puede ver/operar: vista ejecutiva del
 *     proyecto, leads nominales, calculadora, configuración propia.
 *
 * La barrera real está en DB (cliente_role no tiene grant a las tablas
 * sensibles, ver migración 0023). Esta sidebar es cosmética — si alguien
 * tipea una URL del shell de equipo, el redirect del (app)/layout.tsx lo
 * manda acá.
 */
export function ClientSidebar() {
  return (
    <aside className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-bg-elevated px-4 py-6">
      <div className="mb-8 px-2">
        <span className="text-base font-bold text-accent">Launch OS</span>
        <div className="mt-0.5 text-[10px] uppercase tracking-wider text-fg-subtle">
          Portal del cliente
        </div>
      </div>

      <nav className="space-y-1">
        <ClientNavLink scopedSuffix="" exact>
          Overview
        </ClientNavLink>
        <ClientNavLink scopedSuffix="/launches">Lanzamientos</ClientNavLink>
        <ClientNavLink scopedSuffix="/leads">Leads</ClientNavLink>
        <ClientNavLink href="/portal/calculadora">Calculadora</ClientNavLink>
      </nav>
    </aside>
  );
}
