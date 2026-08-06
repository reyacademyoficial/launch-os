import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import { IconAca } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";

export const metadata: Metadata = { title: "Certificados · Academia" };

/**
 * Certificados — placeholder de andamio.
 *
 * En el commit siguiente: tabla de `certificates` con student, course,
 * código (opcional), fecha emisión, URL. Unique (student, course).
 * Emisión MANUAL — no hay automatismo al aprobar examen (decisión del
 * schema, YAGNI).
 */
export default function CertificadosPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconAca size={16} />}
        title="Certificados"
        stats={[
          { l: "Emitidos", v: fCount(0) },
          { l: "Estudiantes certificados", v: fCount(0) },
        ]}
      />
      <Panel title="Certificados emitidos">
        <EmptyState
          icon={<IconAca size={22} />}
          title="Sin certificados emitidos"
          hint="Los certificados son manuales — el operador los emite cuando corresponde (no se autogeneran al aprobar exámenes). Un estudiante puede tener múltiples certificados si cursó varios cursos."
        />
      </Panel>
    </div>
  );
}
