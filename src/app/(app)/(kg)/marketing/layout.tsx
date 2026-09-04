import { requireRole } from "@/lib/supabase/auth";
import { KgModuleNav } from "@/components/kg/module-nav";
import type { TabItem } from "@/components/kg/tabs-bar";

/**
 * Layout del módulo Marketing (pipeline creativo: planificación → grabación →
 * edición → publicación).
 *
 * Visible para superadmin / admin / coordinador / operador. El operador ve el
 * módulo entero pero cada sub-vista filtra a lo suyo server-side por
 * assignee (patrón `/operaciones/tareas`, se aplica en cada page cuando
 * corresponda). Cliente es redirigido a `/lanzamientos` por requireRole.
 */
export default async function MarketingLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  await requireRole("superadmin", "admin", "coordinador", "operador");

  const tabs: readonly TabItem[] = [
    { href: "/marketing", label: "Dashboard" },
    { href: "/marketing/planificacion", label: "Planificación" },
    { href: "/marketing/grabacion", label: "Grabación" },
    { href: "/marketing/crudos", label: "Crudos" },
    { href: "/marketing/edicion", label: "Edición" },
    { href: "/marketing/subidas", label: "Subidas" },
    { href: "/marketing/stock", label: "Stock" },
    { href: "/marketing/duenos", label: "Dueños" },
    { href: "/marketing/cadencias", label: "Cadencias" },
    { href: "/marketing/disponibilidad", label: "Disponibilidad" },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <KgModuleNav items={tabs} />
      {children}
    </div>
  );
}
