import { redirect } from "next/navigation";

import { ProjectShell } from "@/components/project/shell";
import { listAccessibleProjects } from "@/lib/projects/list";
import { requireSessionProfile } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { readThemeCookie } from "@/lib/theme-cookie";

/**
 * ProjectShell wrapper + per-project access guard.
 *
 * Guard (RLS layer #2): un usuario no autorizado que tipea
 * `/proyectos/<other-id>/…` es redirigido a `/` en lugar de ver una page
 * vacía (RLS oculta todo). Útil por UX y como no-disclosure de IDs.
 *
 * Shell: acá se monta el ProjectShell — con la sidebar scoped al proyecto y
 * el botón "← Kingrow" en el topbar. KingrowShell y ProjectShell son
 * mutuamente excluyentes: éste no está anidado dentro del otro.
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  readonly children: React.ReactNode;
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();

  if (!data) redirect("/");

  const [profile, projects, theme] = await Promise.all([
    requireSessionProfile(),
    listAccessibleProjects(),
    readThemeCookie(),
  ]);

  return (
    <ProjectShell profile={profile} projects={projects} theme={theme}>
      {children}
    </ProjectShell>
  );
}
