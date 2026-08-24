import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/kg/module-placeholder";

export const metadata: Metadata = { title: "Marketing" };

/**
 * Dashboard del módulo Marketing.
 *
 * Placeholder mientras se completan los bloques del plan
 * (`docs/marketing-plan.md`). El módulo ya está gateado y navegable — hay
 * tabs para Dueños y Cadencias en el layout, que son las dos primeras
 * pantallas funcionales. El dashboard real (KPIs de stock, alertas de
 * cobertura, próximas grabaciones, etc.) se implementa cuando existan datos
 * en las 9 tablas del módulo (0157-0165).
 */
export default function MarketingDashboardPage() {
  return (
    <ModulePlaceholder
      title="Marketing"
      subtitle="Pipeline creativo: planificación → grabación → edición → publicación"
      description="Empezá cargando dueños de contenido (Rey Academy, Kevin Machado, ...) en la pestaña Dueños, y configurando cadencias de publicación en Cadencias. Las demás pestañas se activan cuando existan datos en las tablas del módulo."
    />
  );
}
