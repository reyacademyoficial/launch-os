"use server";

import { revalidatePath } from "next/cache";

import { summarizeLaunch } from "@/lib/ai/summarize-launch";
import { listDailyForLaunch } from "@/lib/launch-daily/list";
import { getLaunch } from "@/lib/launches/get";
import {
  requireCanEditLaunchesIn,
  requireSessionProfile,
} from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export type SummaryResult = { text: string } | { error: string };

const MODEL_ID = "gpt-summary"; // placeholder hasta exponer el modelo real desde summarizeLaunch

/**
 * Genera un resumen ejecutivo del launch y lo PERSISTE en `ai_runs` para
 * que quede en el historial. La RLS exige `can_edit_launches_in` para INSERT
 * → admin + operador disparan; analista/cliente no.
 *
 * Si la generación falla, persistimos `status='error'` + el error_detail
 * para debug. Esto cubre dos cosas: el historial muestra qué intentos hubo,
 * y queda traza de fallos sin tener que ir a logs externos.
 */
export async function generateLaunchSummary(
  projectId: string,
  launchId: string,
): Promise<SummaryResult> {
  const profile = await requireCanEditLaunchesIn(projectId);

  const launch = await getLaunch(launchId);
  if (!launch || launch.project_id !== projectId) {
    return { error: "No se encontró el lanzamiento (o no tenés acceso)." };
  }

  const daily = await listDailyForLaunch(launchId);
  const supabase = await createClient();

  try {
    const text = await summarizeLaunch(launch, daily);

    const insertPayload = {
      launch_id: launchId,
      project_id: projectId,
      user_id: profile.id,
      model: MODEL_ID,
      status: "success",
      output_text: text,
    } as never;
    await supabase.from("ai_runs").insert(insertPayload);

    revalidatePath(`/proyectos/${projectId}/launches/${launchId}/ia`);
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

    revalidatePath(`/proyectos/${projectId}/launches/${launchId}/ia`);
    return { error: `No pude generar el resumen: ${message}` };
  }
}

/**
 * Lectura read-only — disponible a cualquiera con sesión. Lo dejamos exportado
 * por si en el futuro queremos un endpoint público de "ver historial" desde
 * fuera del Server Component. Hoy no se usa.
 */
export async function ensureSession(): Promise<void> {
  await requireSessionProfile();
}
