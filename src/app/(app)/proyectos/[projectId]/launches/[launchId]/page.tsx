import { redirect } from "next/navigation";

/**
 * Raíz del detalle del launch: redirige al tab principal (KPI). Cada tab vive
 * en su propia sub-page para que solo fetchee lo que necesita.
 */
export default async function LaunchRootPage({
  params,
}: {
  readonly params: Promise<{ projectId: string; launchId: string }>;
}) {
  const { projectId, launchId } = await params;
  redirect(`/proyectos/${projectId}/launches/${launchId}/kpi`);
}
