import { requireRole } from "@/lib/supabase/auth";
import { KgModuleNav } from "@/components/kg/module-nav";
import type { TabItem } from "@/components/kg/tabs-bar";

/**
 * Layout del módulo Financiero.
 *
 * Visible para superadmin / admin. Coordinador queda afuera (regla nueva:
 * coordinador solo Clientes / Academia / Operaciones). Operadores y clientes
 * son redirigidos a su módulo raíz vía requireRole (operador→/operaciones,
 * cliente→/lanzamientos). Los server actions de escritura tienen además
 * su propio requireRole("superadmin") — ese gate NO se afloja acá.
 */
export default async function FinancieroLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  await requireRole("superadmin", "admin");

  const tabs: readonly TabItem[] = [
    { href: "/financiero", label: "Dashboard" },
    { href: "/financiero/facturas", label: "Facturas" },
    { href: "/financiero/gastos", label: "Gastos" },
    { href: "/financiero/nomina", label: "Nómina" },
    { href: "/financiero/bancos", label: "Bancos" },
    { href: "/financiero/metodos-pago", label: "Métodos de pago" },
    { href: "/financiero/movimientos", label: "Movimientos" },
    { href: "/financiero/transferencias", label: "Transferencias" },
    { href: "/financiero/liquidaciones", label: "Liquidaciones" },
    { href: "/financiero/activos", label: "Activos" },
    { href: "/financiero/pasivos", label: "Pasivos" },
    { href: "/financiero/tasas", label: "Tasas FX" },
    { href: "/financiero/reportes/bancos", label: "Reportes" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <KgModuleNav items={tabs} />
      {children}
    </div>
  );
}
