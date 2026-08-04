import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import { IconCli } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";

export const metadata: Metadata = { title: "NPS · Clientes" };

/**
 * Respuestas de NPS por cliente — placeholder de andamio.
 *
 * En el commit siguiente: tabla de respuestas NPS con filtros por cliente
 * y período + drawer para carga rápida. Alimentado por la tabla
 * `nps_responses` (migración 0081). Clasificación por score
 * (promoter 9-10 · pasivo 7-8 · detractor 0-6) via `classifyNps` en
 * `src/lib/clients/health.ts`.
 *
 * NPS acá = encuesta al contacto de la empresa cliente hacia Kingrow. NO
 * es NPS de los alumnos del launch (eso viviría en otro plano).
 */
export default function NpsPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconCli size={16} />}
        title="NPS"
        stats={[
          { l: "Respuestas (90d)", v: fCount(0) },
          { l: "NPS score", v: "—" },
          { l: "Promotores", v: fCount(0) },
          { l: "Detractores", v: fCount(0) },
        ]}
      />
      <Panel title="Respuestas NPS">
        <EmptyState
          icon={<IconCli size={22} />}
          title="Sin respuestas NPS cargadas"
          hint="El NPS mide la satisfacción del contacto principal del cliente con Kingrow. Se carga cada respuesta con score (0–10), comentario y canal — el NPS agregado y la clasificación (promotor/pasivo/detractor) se calculan solos."
        />
      </Panel>
    </div>
  );
}
