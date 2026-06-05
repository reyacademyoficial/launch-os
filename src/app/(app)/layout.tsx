import { Shell } from "@/components/dashboard/shell";
import { listAccessibleProjects } from "@/lib/projects/list";
import { requireSessionProfile } from "@/lib/supabase/auth";

/**
 * Protected layout — auth defense layer #2 + the app chrome.
 * Real navigation lives in <Shell>; this file gates, fetches accessible
 * projects (for the topbar switcher), and forwards.
 */
export default async function AppLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const profile = await requireSessionProfile();
  const projects = await listAccessibleProjects();
  return (
    <Shell profile={profile} projects={projects}>
      {children}
    </Shell>
  );
}
