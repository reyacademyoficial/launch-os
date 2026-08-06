import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import { IconOps } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";

export const metadata: Metadata = { title: "Operaciones" };

/**
 * Dashboard del módulo Operaciones — placeholder de andamio.
 *
 * En commits siguientes acá va: KPIs de carga (tareas abiertas/vencidas/
 * próximas por persona), throughput (tareas cerradas en período,
 * avgCycleDays), horas dedicadas (Σ minutos por persona), bloqueadores
 * abiertos, ranking de productividad por persona con período configurable.
 *
 * Todo alimentado por selectores puros en `src/lib/ops/`:
 * `computeLoadByPerson`, `computeThroughput`, `sumMinutesByPerson`,
 * `filterOverdueTasks`. Cero lógica nueva de negocio acá.
 */
export default function OperacionesDashboardPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconOps size={16} />}
        title="Operaciones"
        stats={[
          { l: "Proyectos activos", v: fCount(0) },
          { l: "Tareas abiertas", v: fCount(0) },
          { l: "Bloqueadores", v: fCount(0) },
          { l: "Horas del mes", v: "—" },
        ]}
      />
      <Panel title="Salud operativa">
        <EmptyState
          icon={<IconOps size={22} />}
          title="Sin proyectos ni tareas cargadas"
          hint="Operaciones administra el trabajo interno de Kingrow: proyectos, tareas, bloqueos, tiempo, procesos. Empezá cargando personas (Organización) y después dando de alta un proyecto interno en la pestaña Proyectos."
        />
      </Panel>
    </div>
  );
}
