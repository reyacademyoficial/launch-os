import { requireSessionProfile } from "@/lib/supabase/auth";
import { KgTabsBar, type TabItem } from "@/components/kg/tabs-bar";

/**
 * Layout del módulo Financiero. Envuelve el dashboard + las 8 pestañas con
 * la barra de navegación intra-módulo.
 *
 * GATE DE ROL — no endurecer ni aflojar respecto a lo actual.
 * El dashboard de Financiero hoy solo depende del gate ambiente de
 * `(app)/layout.tsx` (rechaza a cliente). Los server actions de escritura
 * viven en la ruta de liquidaciones y tienen su propio `requireRole("superadmin")`
 * — ese gate NO se afloja acá.
 *
 * La pestaña "Liquidaciones" se muestra a todos los roles no-cliente en el
 * TabsBar; si un rol sin permiso (analista/operador) hace click, la page
 * de liquidaciones lo rebota a "/" via requireRole. Es defensa duplicada:
 * la UI no la esconde, pero la ruta no la deja pasar. Es la misma política
 * que tiene el sidebar con Organización/Sistema.
 */
export default async function FinancieroLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  await requireSessionProfile();

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
      <KgTabsBar items={tabs} />
      {children}
    </div>
  );
}
