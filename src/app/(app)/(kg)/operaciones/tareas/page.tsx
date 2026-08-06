import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import { IconOps } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";

export const metadata: Metadata = { title: "Tareas · Operaciones" };

/**
 * Lista global de tareas — placeholder de andamio.
 *
 * En el commit siguiente:
 *   - Filtro **"mis tareas"** por default para operador/analista/etc.
 *     (server-scoped por auth_user_id → person_id → assignee_id).
 *     Superadmin/dev arrancan viendo TODAS con toggle a "mis tareas".
 *   - Marcado visual de vencidas (dot rojo + badge "Vencida") — sin
 *     mutar priority en DB.
 *   - Drawer para alta con proyecto opcional, assignee opcional.
 *   - Filtros por status/priority/proyecto.
 *
 * Requiere primero la migración de `organization_people.auth_user_id`
 * (§2.2 del plan).
 */
export default function TareasPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconOps size={16} />}
        title="Tareas"
        stats={[
          { l: "Abiertas", v: fCount(0) },
          { l: "Vencidas", v: fCount(0) },
          { l: "Próximas (7d)", v: fCount(0) },
        ]}
      />
      <Panel title="Tareas">
        <EmptyState
          icon={<IconOps size={22} />}
          title="Sin tareas cargadas"
          hint="Cada tarea puede colgar de un proyecto interno o vivir suelta (ad-hoc). Se asigna a una persona real de la organización. Estados: todo, doing, blocked, done, cancelled."
        />
      </Panel>
    </div>
  );
}
