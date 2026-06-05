"use server";

import { summarizeLaunch } from "@/lib/ai/summarize-launch";
import { listDailyForLaunch } from "@/lib/launch-daily/list";
import { getLaunch } from "@/lib/launches/get";
import { requireSessionProfile } from "@/lib/supabase/auth";

export type SummaryResult = { text: string } | { error: string };

/**
 * Generates an executive summary for a launch. Read-only operation — anyone
 * with project access (cliente included) can request it. RLS makes
 * `getLaunch` return null for non-members, in which case we error.
 *
 * Auth boundary: `requireSessionProfile` ensures a user is logged in. RLS in
 * `getLaunch` handles the project-membership check. We additionally guard
 * the URL-tampering case (launch belongs to a different project than the
 * one in the URL).
 */
export async function generateLaunchSummary(
  projectId: string,
  launchId: string,
): Promise<SummaryResult> {
  await requireSessionProfile();

  const launch = await getLaunch(launchId);
  if (!launch || launch.project_id !== projectId) {
    return { error: "No se encontró el lanzamiento (o no tenés acceso)." };
  }

  const daily = await listDailyForLaunch(launchId);

  try {
    const text = await summarizeLaunch(launch, daily);
    return { text };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error inesperado";
    return { error: `No pude generar el resumen: ${message}` };
  }
}
