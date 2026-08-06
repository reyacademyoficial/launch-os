import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import { IconOps } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";

export const metadata: Metadata = { title: "Bloqueadores · Operaciones" };

/**
 * Lista global de bloqueadores — placeholder de andamio.
 *
 * En el commit siguiente: tabla de `blockers` con XOR (task o project),
 * motivo, opened_at, resolved_at, resolved_by. Filtros por
 * abiertos/resueltos/todos + drawer para abrir/resolver.
 *
 * Los bloqueadores son independientes de `tasks.status='blocked'` — se
 * puede registrar un bloqueo informativo sin cambiar el estado operativo
 * de la tarea ("esperando feedback pero seguimos avanzando").
 */
export default function BloqueadoresPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconOps size={16} />}
        title="Bloqueadores"
        stats={[
          { l: "Abiertos", v: fCount(0) },
          { l: "Resueltos", v: fCount(0) },
        ]}
      />
      <Panel title="Bloqueadores">
        <EmptyState
          icon={<IconOps size={22} />}
          title="Sin bloqueadores cargados"
          hint="Un bloqueador cuelga de UNA tarea o UN proyecto interno (XOR duro). Requiere un motivo. Se resuelve registrando quién lo levantó y cuándo. Múltiples bloqueadores por tarea/proyecto son válidos."
        />
      </Panel>
    </div>
  );
}
