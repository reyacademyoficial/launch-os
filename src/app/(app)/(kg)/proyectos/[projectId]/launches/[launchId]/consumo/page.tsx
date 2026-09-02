import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ConsumptionPanel } from "@/components/dashboard/launches/consumption/consumption-panel";
import { ContextBar } from "@/components/kg/context-bar";
import { IconLaunch } from "@/components/kg/icons";
import { fmtDate, fmtNumber } from "@/lib/format";
import { getConsumptionForLaunch } from "@/lib/launch-consumption/get";
import { getLaunch } from "@/lib/launches/get";
import { userCanEditLaunchesIn } from "@/lib/supabase/auth";

import { saveConsumption } from "../consumption-actions";

export const metadata: Metadata = { title: "Consumo · Lanzamiento" };

/**
 * Tab "Consumo": grilla horaria de asistentes por clase + chart comparativo.
 * El editor es un solo panel client: config (horas + clases) arriba, matriz
 * en el medio, métricas + chart abajo. Se guarda entero en cada botón.
 */
export default async function LaunchConsumptionPage({
  params,
}: {
  readonly params: Promise<{ projectId: string; launchId: string }>;
}) {
  const { projectId, launchId } = await params;

  const [launch, canEdit, state] = await Promise.all([
    getLaunch(launchId),
    userCanEditLaunchesIn(projectId),
    getConsumptionForLaunch(launchId),
  ]);

  if (!launch || launch.project_id !== projectId) notFound();

  const isClosed = launch.closed_at !== null;
  const action = saveConsumption.bind(null, projectId, launchId);

  return (
    <div className="flex flex-col gap-5">
      {/*
        Los totales de asistentes los calcula el panel client a partir de la
        matriz; acá mostramos la forma de la grilla (lo que define cuántas
        celdas hay que llenar) + cuándo se guardó por última vez.
      */}
      <ContextBar
        icon={<IconLaunch size={16} />}
        title="Consumo"
        stats={[
          { l: "Clases", v: fmtNumber(state.config.classes.length) },
          {
            l: "Franja horaria",
            v: `${state.config.startTime}–${state.config.endTime}`,
          },
          {
            l: "Intervalo",
            v: `${fmtNumber(state.config.intervalMinutes)} min`,
          },
          { l: "Última carga", v: fmtDate(state.updatedAt) },
        ]}
      />

      <ConsumptionPanel
        initialState={state}
        action={action}
        readOnly={!canEdit || isClosed}
        readOnlyReason={
          !canEdit
            ? "Solo lectura — no tenés permisos para editar este lanzamiento."
            : isClosed
              ? "Lanzamiento cerrado — reabrilo para modificar la grilla."
              : null
        }
      />
    </div>
  );
}
