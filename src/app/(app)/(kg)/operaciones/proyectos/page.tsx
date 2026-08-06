import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import { IconOps } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";

export const metadata: Metadata = { title: "Proyectos internos · Operaciones" };

/**
 * Lista de proyectos internos — placeholder de andamio.
 *
 * En el commit siguiente: tabla de `internal_projects` con owner (persona),
 * status, priority, fechas, % de avance (derivado de tasks done sobre
 * total del proyecto). Filtros por status/priority/owner + drawer para
 * alta/edición.
 *
 * IMPORTANTE: la tabla `internal_projects` NO es lo mismo que `projects`
 * (LaunchOS project-scope, empresas gestionadas). Ver comentario del
 * schema 0090.
 */
export default function ProyectosInternosPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconOps size={16} />}
        title="Proyectos internos"
        stats={[
          { l: "Total", v: fCount(0) },
          { l: "Activos", v: fCount(0) },
          { l: "En pausa", v: fCount(0) },
        ]}
      />
      <Panel title="Proyectos internos">
        <EmptyState
          icon={<IconOps size={22} />}
          title="Sin proyectos internos cargados"
          hint="Un proyecto interno es una iniciativa de Kingrow (rediseño web, migración de stack, contratación de nuevo closer). NO se confunde con los proyectos de LaunchOS — esos son empresas gestionadas y viven en Clientes."
        />
      </Panel>
    </div>
  );
}
