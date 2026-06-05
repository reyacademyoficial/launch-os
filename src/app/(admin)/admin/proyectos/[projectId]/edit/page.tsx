import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ProjectForm } from "@/components/dashboard/admin/project-form";
import { createClient } from "@/lib/supabase/server";

import { updateProject } from "../../actions";

export const metadata: Metadata = { title: "Editar proyecto" };

interface ProjectEditRow {
  id: string;
  name: string;
  business_name: string | null;
}

export default async function EditProjectPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("id, name, business_name")
    .eq("id", projectId)
    .maybeSingle();

  const project = data as ProjectEditRow | null;
  if (!project) notFound();

  const action = updateProject.bind(null, projectId);

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Editar proyecto</h1>
        <p className="mt-1 text-sm text-fg-muted">{project.name}</p>
      </header>

      <ProjectForm action={action} initial={project} submitLabel="Guardar cambios" />
    </section>
  );
}
