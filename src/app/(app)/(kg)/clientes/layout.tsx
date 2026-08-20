import { requireRole } from "@/lib/supabase/auth";
import { KgModuleNav } from "@/components/kg/module-nav";
import type { TabItem } from "@/components/kg/tabs-bar";

/**
 * Layout del módulo Clientes (CRM: tickets, renovaciones, upsells, NPS).
 *
 * Visible para superadmin / admin / coordinador. Operadores y clientes son
 * redirigidos a su módulo raíz vía requireRole.
 */
export default async function ClientesLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  await requireRole("superadmin", "admin", "coordinador");

  const tabs: readonly TabItem[] = [
    { href: "/clientes", label: "Dashboard" },
    { href: "/clientes/tickets", label: "Tickets" },
    { href: "/clientes/renovaciones", label: "Renovaciones" },
    { href: "/clientes/upsells", label: "Upsells" },
    { href: "/clientes/nps", label: "NPS" },
  ];

  return (
    // h-full + min-h-0 habilita flex-fill de tablas en las pages hijas.
    <div className="flex h-full min-h-0 flex-col gap-4">
      <KgModuleNav items={tabs} />
      {children}
    </div>
  );
}
