import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import { IconAca } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";

export const metadata: Metadata = { title: "Estudiantes · Academia" };

/**
 * Lista de estudiantes — placeholder de andamio.
 *
 * En el commit siguiente: tabla de `students` con project (empresa
 * propia), name, email, phone, status (active|inactive|graduated),
 * cohorte activa. Alta con dropdown "Origen": desde venta LaunchOS
 * (auto-fill de datos + link sale_id via 0112) o carga manual.
 */
export default function EstudiantesPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconAca size={16} />}
        title="Estudiantes"
        stats={[
          { l: "Total", v: fCount(0) },
          { l: "Activos", v: fCount(0) },
          { l: "Graduados", v: fCount(0) },
        ]}
      />
      <Panel title="Estudiantes">
        <EmptyState
          icon={<IconAca size={22} />}
          title="Sin estudiantes cargados"
          hint="Los estudiantes son los alumnos de las empresas propias — los compradores finales de un lanzamiento cuando el producto es un curso. Se cargan a mano o vinculando la venta de LaunchOS (auto-fill + trazabilidad al comprador)."
        />
      </Panel>
    </div>
  );
}
