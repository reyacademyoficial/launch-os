import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LaunchIntegrationsSection } from "@/components/dashboard/launches/integrations/launch-integrations-section";
import { getLaunch } from "@/lib/launches/get";
import { userCanEditLaunchesIn } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "Integraciones · Lanzamiento" };

export default async function LaunchIntegrationsPage({
  params,
}: {
  readonly params: Promise<{ projectId: string; launchId: string }>;
}) {
  const { projectId, launchId } = await params;

  const [launch, canEditLaunchValue] = await Promise.all([
    getLaunch(launchId),
    userCanEditLaunchesIn(projectId),
  ]);

  if (!launch || launch.project_id !== projectId) notFound();

  const isClosed = launch.closed_at !== null;

  // Cliente y analista no editan integraciones — la sección no tiene sentido
  // de mostrar. Le damos un mensaje minimal en vez de un layout vacío.
  if (!canEditLaunchValue) {
    return (
      <div className="rounded-md border border-dashed border-border bg-surface/40 p-8 text-center text-sm text-fg-muted">
        Sin permisos para ver o editar las integraciones de este lanzamiento.
      </div>
    );
  }

  return (
    <LaunchIntegrationsSection
      projectId={projectId}
      launchId={launchId}
      isClosed={isClosed}
    />
  );
}
