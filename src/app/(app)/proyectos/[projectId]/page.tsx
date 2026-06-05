import type { Metadata } from "next";

import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  // Fetch the project name for a friendly header. RLS already validated
  // access in the parent layout.
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("name, business_name")
    .eq("id", projectId)
    .maybeSingle();

  const project = data as { name: string; business_name: string | null } | null;
  const name = project?.name ?? "Proyecto";

  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-bold">{name}</h1>
      {project?.business_name && (
        <p className="text-sm text-fg-subtle">{project.business_name}</p>
      )}
      <p className="mt-3 text-sm text-fg-muted">
        Overview con KPIs agregados de los lanzamientos del proyecto — placeholder.
        Se llena en Fase 5.B con los datos reales.
      </p>
    </section>
  );
}
