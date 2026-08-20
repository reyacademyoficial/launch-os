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
    // h-full + min-h-0 habilita flex-fill de tablas en las pages hijas.
    <div className="flex h-full min-h-0 flex-col gap-4">
      <KgModuleNav items={tabs} />
      {children}
    </div>
  );
}
