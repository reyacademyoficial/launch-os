import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LaunchForm } from "@/components/dashboard/launches/launch-form";
import { getLaunch } from "@/lib/launches/get";
import { requireCanEditLaunch } from "@/lib/supabase/auth";

import { updateLaunch } from "../../actions";

export const metadata: Metadata = { title: "Editar lanzamiento" };

export default async function EditLaunchPage({
  params,
}: {
  readonly params: Promise<{ projectId: string; launchId: string }>;
}) {
  const { projectId, launchId } = await params;
  // Launch-scope: operador asignado con can_edit edita el form igual que admin.
  await requireCanEditLaunch(projectId, launchId);

  const launch = await getLaunch(launchId);
  if (!launch || launch.project_id !== projectId) notFound();

  const action = updateLaunch.bind(null, projectId, launchId);

  return (
    <section className="max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Editar lanzamiento</h1>
        <p className="mt-1 text-sm text-fg-muted">{launch.name}</p>
      </header>

      <LaunchForm action={action} initial={launch} submitLabel="Guardar cambios" />
    </section>
  );
}
