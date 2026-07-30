import { requireSessionProfile } from "@/lib/supabase/auth";
import { KgTabsBar, type TabItem } from "@/components/kg/tabs-bar";

/**
 * Layout del módulo Comercial. Envuelve las pestañas cross-proyecto que
 * antes vivían bajo `/proyectos/[id]/*` (productos, equipo, comisiones,
 * ranking). Cada tab acepta selector de proyecto para acotar.
 *
 * GATE DE ROL — no endurecer ni aflojar.
 * Igual criterio que `/financiero/layout.tsx`: el módulo depende del gate
 * ambient de `(app)/layout.tsx` (rechaza cliente). Los server actions de
 * escritura tienen su propio `requireRole("superadmin")` — ese gate NO se
 * afloja acá.
 *
 * Las pestañas se muestran a todos los roles no-cliente. Si un rol sin
 * permiso hace click en una acción de escritura, la server action lo rebota
 * a "/" via requireRole. Misma política que Financiero.
 *
 * En 6d-C1 arrancan Productos y Equipo (los simples). En 6d-C2 se suman
 * Comisiones y Ranking.
 */
export default async function ComercialLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  await requireSessionProfile();

  const tabs: readonly TabItem[] = [
    { href: "/comercial/productos", label: "Productos" },
    { href: "/comercial/equipo", label: "Equipo de ventas" },
    // TODO 6d-C2: agregar Comisiones y Ranking cuando estén.
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <KgTabsBar items={tabs} />
      {children}
    </div>
  );
}
