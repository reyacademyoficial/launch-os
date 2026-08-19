import { KgModuleNav } from "@/components/kg/module-nav";
import type { TabItem } from "@/components/kg/tabs-bar";

/**
 * Sub-nav de Reportes: cambiar de reporte sin salir del área. Se apoya en el
 * TabsBar del módulo — mismo componente que la nav de arriba (financiero/
 * layout.tsx), aplicado como fila secundaria.
 */
export default function ReportesLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const tabs: readonly TabItem[] = [
    { href: "/financiero/reportes/bancos", label: "Bancos" },
    { href: "/financiero/reportes/facturas", label: "Facturas" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <KgModuleNav items={tabs} />
      {children}
    </div>
  );
}
