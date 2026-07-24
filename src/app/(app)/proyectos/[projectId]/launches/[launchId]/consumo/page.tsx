import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ConsumptionPanel } from "@/components/dashboard/launches/consumption/consumption-panel";
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
  );
}
