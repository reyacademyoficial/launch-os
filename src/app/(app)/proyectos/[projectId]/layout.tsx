import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * Per-project access guard.
 *
 * RLS (`projects_select`) already restricts who can read which projects.
 * Calling `.from('projects').select('id').eq(...)` and getting `null` means
 * the caller has no access (or the id doesn't exist) — either way, bounce.
 *
 * This is defense layer #2: RLS is layer #3. Without this check, an
 * unauthorized user typing `/proyectos/<other-id>/launches` would see an empty
 * launches page (RLS hides everything) instead of being redirected — bad UX
 * and a useful disclosure to attackers about which IDs exist.
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

  return <>{children}</>;
}
