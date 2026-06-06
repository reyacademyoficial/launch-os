import type { ProjectListItem } from "@/lib/projects/list";
import type { SessionProfile } from "@/lib/supabase/auth";

import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

/**
 * App shell. The root container fills the viewport and never scrolls; the
 * sidebar and topbar stay in place while only the `<main>` element scrolls.
 * Pages render inside `<main>` and therefore inherit the scroll container.
 */
export function Shell({
  profile,
  projects,
  children,
}: {
  readonly profile: SessionProfile;
  readonly projects: readonly ProjectListItem[];
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex h-dvh overflow-hidden bg-bg text-fg">
      <Sidebar profile={profile} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar profile={profile} projects={projects} />
        <main className="flex-1 overflow-y-auto px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
