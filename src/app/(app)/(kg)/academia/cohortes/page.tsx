import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import { IconAca } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";

export const metadata: Metadata = { title: "Cohortes · Academia" };

/**
 * Lista de cohortes — placeholder de andamio.
 *
 * En el commit siguiente: tabla de `cohorts` con project (empresa
 * propia), course opcional, fechas, status (planned|active|finished|
 * cancelled), estudiantes inscriptos. Ficha con clases + inscripciones
 * + exámenes.
 */
export default function CohortesPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconAca size={16} />}
        title="Cohortes"
        stats={[
          { l: "Activas", v: fCount(0) },
          { l: "Planificadas", v: fCount(0) },
          { l: "Terminadas", v: fCount(0) },
        ]}
      />
      <Panel title="Cohortes">
        <EmptyState
          icon={<IconAca size={22} />}
          title="Sin cohortes cargadas"
          hint="Una cohorte es un grupo de estudiantes que cursa un programa en un período específico. Requiere un curso (opcional) y un proyecto propio. Empezá creando el curso primero desde la pestaña Cursos."
        />
      </Panel>
    </div>
  );
}
