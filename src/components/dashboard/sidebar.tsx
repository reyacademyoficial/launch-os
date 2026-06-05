import type { SessionProfile } from "@/lib/supabase/auth";

import { NavLink } from "./nav-link";

interface NavItem {
  href: string;
  label: string;
}

const APP_NAV: readonly NavItem[] = [
  { href: "/", label: "Overview" },
  { href: "/launches", label: "Lanzamientos" },
  { href: "/calculadora", label: "Calculadora" },
  { href: "/integraciones", label: "Integraciones" },
  { href: "/configuracion", label: "Configuración" },
];

const ADMIN_NAV: readonly NavItem[] = [
  { href: "/proyectos", label: "Proyectos" },
  { href: "/usuarios", label: "Usuarios" },
];

export function Sidebar({ profile }: { readonly profile: SessionProfile }) {
  const showAdmin = profile.role === "superadmin";

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-bg-elevated px-4 py-6">
      <div className="mb-8 px-2">
        <span className="text-base font-bold text-accent">Launch OS</span>
      </div>

      <nav className="space-y-1">
        {APP_NAV.map((item) => (
          <NavLink key={item.href} href={item.href}>
            {item.label}
          </NavLink>
        ))}
      </nav>

      {showAdmin && (
        <>
          <div className="mb-2 mt-8 px-3 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
            Admin
          </div>
          <nav className="space-y-1">
            {ADMIN_NAV.map((item) => (
              <NavLink key={item.href} href={item.href}>
                {item.label}
              </NavLink>
            ))}
          </nav>
        </>
      )}
    </aside>
  );
}
