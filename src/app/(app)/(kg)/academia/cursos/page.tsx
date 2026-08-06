import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import { IconAca } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";

export const metadata: Metadata = { title: "Cursos · Academia" };

/**
 * Lista de cursos — placeholder de andamio.
 *
 * En el commit siguiente: tabla de `courses` (fino sobre products, ver
 * 0072). Un product de un proyecto propio SE PUEDE convertir en course
 * agregando metadatos académicos: duration_hours, modules_count,
 * syllabus. courses.product_id UNIQUE — un product es máximo 1 course.
 */
export default function CursosPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconAca size={16} />}
        title="Cursos"
        stats={[
          { l: "Activos", v: fCount(0) },
          { l: "Archivados", v: fCount(0) },
        ]}
      />
      <Panel title="Cursos">
        <EmptyState
          icon={<IconAca size={22} />}
          title="Sin cursos cargados"
          hint="Un curso es una capa académica sobre un producto existente (duración, módulos, syllabus). El producto se crea en Comercial → Productos; acá se marca como curso. Cada producto puede ser a lo sumo 1 curso."
        />
      </Panel>
    </div>
  );
}
