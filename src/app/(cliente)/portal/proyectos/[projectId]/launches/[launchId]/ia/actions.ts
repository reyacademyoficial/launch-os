"use server";

import { revalidatePath } from "next/cache";

import { summarizeLaunch } from "@/lib/ai/summarize-launch";
import { listAdsForLaunch, listDailyForLaunch } from "@/lib/launch-daily/list";
import { getKanbanSalesAggregateForLaunch } from "@/lib/launch-sales/list";
import { getLaunch } from "@/lib/launches/get";
import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export type ClientSummaryResult = { text: string } | { error: string };

const MODEL_ID = "gpt-summary";

/**
 * Genera un resumen ejecutivo del launch para el cliente y lo persiste en
 * `ai_runs`. Diff vs `generateLaunchSummary` del equipo:
 *   - Gate por rol cliente (requireRole) + `user_id = auth.uid()` para que la
 *     RLS `ai_runs_insert` (cláusula `created_by = auth.uid()`) acepte.
 *   - `summarizeLaunch` se reusa tal cual — no toca tablas blindadas
 *     (team_members / commission_rules), opera solo con launch + daily +
 *     opportunities + KPIs, todas accesibles a `cliente_role`.
 */
export async function generateClientLaunchSummary(
  projectId: string,
  launchId: string,
): Promise<ClientSummaryResult> {
  const profile = await requireRole("cliente");

  const launch = await getLaunch(launchId);
  if (!launch || launch.project_id !== projectId) {
    return { error: "No se encontró el lanzamiento (o no tenés acceso)." };
  }

  const [daily, ads, kanbanSalesAggregate] = await Promise.all([
    listDailyForLaunch(launchId),
    listAdsForLaunch(launchId),
    getKanbanSalesAggregateForLaunch(projectId, launchId),
  ]);
  const supabase = await createClient();

  try {
    const text = await summarizeLaunch(launch, daily, ads, kanbanSalesAggregate);

    const insertPayload = {
      launch_id: launchId,
      project_id: projectId,
      user_id: profile.id,
      model: MODEL_ID,
      status: "success",
      output_text: text,
    } as never;
    await supabase.from("ai_runs").insert(insertPayload);

    revalidatePath(`/portal/proyectos/${projectId}/launches/${launchId}/ia`);
    return { text };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error inesperado";

    const insertPayload = {
      launch_id: launchId,
      project_id: projectId,
      user_id: profile.id,
      model: MODEL_ID,
      status: "error",
      error_detail: { message } as Record<string, unknown>,
    } as never;
    await supabase.from("ai_runs").insert(insertPayload);

    revalidatePath(`/portal/proyectos/${projectId}/launches/${launchId}/ia`);
    return { error: `No pude generar el resumen: ${message}` };
  }
}
