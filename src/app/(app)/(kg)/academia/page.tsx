import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import { IconAca } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";

export const metadata: Metadata = { title: "Academia" };

/**
 * Dashboard de Academia — placeholder de andamio.
 *
 * En el commit final del bloque acá va: KPIs de src/lib/academia/kpis.ts
 * (activeStudents, completionRate, averageAttendance, examPassRate,
 * certificationRate) + panel de cohortes activas + certificados emitidos
 * en el período.
 */
export default function AcademiaDashboardPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconAca size={16} />}
        title="Academia"
        stats={[
          { l: "Estudiantes activos", v: fCount(0) },
          { l: "Cohortes activas", v: fCount(0) },
          { l: "Asistencia promedio", v: "—" },
          { l: "Tasa de aprobación", v: "—" },
        ]}
      />
      <Panel title="Salud de la academia">
        <EmptyState
          icon={<IconAca size={22} />}
          title="Sin cohortes ni estudiantes cargados"
          hint="Academia trackea cursos, cohortes, alumnos, asistencia, exámenes y certificados de las empresas propias (Rey Academy, Growins). Empezá cargando un curso desde la pestaña Cursos y después una cohorte."
        />
      </Panel>
    </div>
  );
}
