import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import { IconCli } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";

export const metadata: Metadata = { title: "Clientes" };

/**
 * Dashboard del módulo Clientes — placeholder de andamio.
 *
 * En el siguiente commit acá va: grid/tabla de clientes gestionados con
 * health score, LTV, estado de la relación y último contacto. Alimentado
 * por selectores en src/lib/clients/ (health, ltv, churn) sobre las 5
 * tablas org-scope 0080-0084.
 */
export default function ClientesDashboardPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconCli size={16} />}
        title="Clientes"
        stats={[
          { l: "Total", v: fCount(0) },
          { l: "Activos", v: fCount(0) },
          { l: "En riesgo", v: fCount(0) },
          { l: "LTV promedio", v: "—" },
        ]}
      />
      <Panel title="Clientes gestionados">
        <EmptyState
          icon={<IconCli size={22} />}
          title="Todavía no hay clientes con salud registrada"
          hint="Un cliente en Kingrow es una empresa externa que contratás como agencia. Los proyectos se dan de alta en Sistema → Proyectos; después acá se registra la salud de la relación: contacto reciente, tickets, renovaciones, NPS, upsells."
        />
      </Panel>
    </div>
  );
}
