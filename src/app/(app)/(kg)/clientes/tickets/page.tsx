import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import { IconCli } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";

export const metadata: Metadata = { title: "Tickets · Clientes" };

/**
 * Tickets globales del módulo Clientes — placeholder de andamio.
 *
 * En el commit siguiente: tabla de tickets con filtros (estado, prioridad,
 * cliente, asignado) + drawer para carga rápida cross-cliente. Alimentado
 * por la tabla `tickets` (migración 0082). El invariante duro
 * `status ∈ {resuelto,cerrado} ↔ resolved_at IS NOT NULL` lo enforza la DB
 * y el drawer.
 */
export default function TicketsPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconCli size={16} />}
        title="Tickets"
        stats={[
          { l: "Abiertos", v: fCount(0) },
          { l: "Urgentes", v: fCount(0) },
          { l: "Vencidos", v: fCount(0) },
        ]}
      />
      <Panel title="Tickets">
        <EmptyState
          icon={<IconCli size={22} />}
          title="Sin tickets cargados"
          hint="Cada ticket es un pedido, incidencia o tarea de Kingrow hacia un cliente (reunión pendiente, campaña en pausa, cambio de plan). Se cargan desde acá con estado, prioridad y asignado dentro del equipo."
        />
      </Panel>
    </div>
  );
}
