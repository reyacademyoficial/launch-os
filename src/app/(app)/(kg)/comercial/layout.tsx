import { requireRole } from "@/lib/supabase/auth";
import { KgTabsBar, type TabItem } from "@/components/kg/tabs-bar";

/**
 * Layout del módulo Comercial (productos, equipo de ventas, comisiones, ranking).
 *
 * Visible para superadmin / admin. Coordinador queda afuera (regla nueva:
 * coordinador solo Clientes / Academia / Operaciones). Operadores y clientes
 * son redirigidos a su módulo raíz vía requireRole. Los server actions de
 * escritura tienen además su propio requireRole("superadmin").
 */
export default async function ComercialLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  await requireRole("superadmin", "admin");

  const tabs: readonly TabItem[] = [
    { href: "/comercial/productos", label: "Productos" },
    { href: "/comercial/equipo", label: "Equipo de ventas" },
    { href: "/comercial/comisiones", label: "Comisiones" },
    { href: "/comercial/ranking", label: "Ranking" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <KgTabsBar items={tabs} />
      {children}
    </div>
  );
}
