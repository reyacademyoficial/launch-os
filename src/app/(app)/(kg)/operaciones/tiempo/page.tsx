import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import { IconOps } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";

export const metadata: Metadata = { title: "Tiempo · Operaciones" };

/**
 * Registro de tiempo — placeholder de andamio.
 *
 * En el commit siguiente: tabla de `time_entries` con person + minutos +
 * fecha + task opcional + proyecto opcional. Filtros por
 * persona/proyecto/tarea/período + drawer para carga.
 *
 * Decisión del schema: es **asiento contable, NO cronómetro**. La persona
 * carga cuánto tiempo dedicó DESPUÉS. `minutes` entero > 0, `logged_on`
 * fecha (un asiento se imputa a un día — trabajar cruzando medianoche =
 * dos asientos).
 *
 * `person_id` on delete RESTRICT: borrar una persona con historial se
 * bloquea a nivel DB. Es dato contable de nómina.
 */
export default function TiempoPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconOps size={16} />}
        title="Tiempo"
        stats={[
          { l: "Asientos del mes", v: fCount(0) },
          { l: "Horas del mes", v: "—" },
        ]}
      />
      <Panel title="Registros de tiempo">
        <EmptyState
          icon={<IconOps size={22} />}
          title="Sin asientos de tiempo cargados"
          hint="Cada persona carga cuántos minutos dedicó cada día y a qué tarea o proyecto (opcional). El sistema no cronometra — es carga post-facto. Alimenta la métrica de horas del dashboard de operaciones."
        />
      </Panel>
    </div>
  );
}
