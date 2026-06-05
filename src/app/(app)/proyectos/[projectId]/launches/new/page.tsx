import type { Metadata } from "next";

import { LaunchForm } from "@/components/dashboard/launches/launch-form";
import { requireCanEditProject } from "@/lib/supabase/auth";

import { createLaunch } from "../actions";

export const metadata: Metadata = { title: "Nuevo lanzamiento" };

export default async function NewLaunchPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await requireCanEditProject(projectId);

  const action = createLaunch.bind(null, projectId);

  return (
    <section className="max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Nuevo lanzamiento</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Los campos numéricos pueden quedar en cero — los KPIs se calculan con safe
          math y no se rompen por datos vacíos.
        </p>
      </header>

      <LaunchForm action={action} submitLabel="Crear lanzamiento" />
    </section>
  );
}
