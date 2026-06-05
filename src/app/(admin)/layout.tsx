import { Shell } from "@/components/dashboard/shell";
import { listAccessibleProjects } from "@/lib/projects/list";
import { requireRole } from "@/lib/supabase/auth";

/**
 * Admin guard — auth defense layer #2.
 *
 * Superadmin-only for now (admin/cliente delta intentionally undefined).
 * Uses the same <Shell> as the (app) group so navigation stays coherent.
 */
export default async function AdminLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const profile = await requireRole("superadmin");
  const projects = await listAccessibleProjects();
  return (
    <Shell profile={profile} projects={projects}>
      {children}
    </Shell>
  );
}
