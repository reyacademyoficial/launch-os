import type { ProjectListItem } from "@/lib/projects/list";
import type { SessionProfile } from "@/lib/supabase/auth";

import { ProjectSwitcher } from "./project-switcher";
import { UserMenu } from "./user-menu";

export function Topbar({
  profile,
  projects,
}: {
  readonly profile: SessionProfile;
  readonly projects: readonly ProjectListItem[];
}) {
  // `ml-auto` on the UserMenu wrapper keeps it pinned right even when
  // ProjectSwitcher renders null (routes where the switcher is hidden).
  // `justify-between` would slide a single child to the left.
  return (
    <header className="flex items-center gap-4 border-b border-border bg-bg-elevated px-8 py-3">
      <ProjectSwitcher projects={projects} />
      <div className="ml-auto">
        <UserMenu profile={profile} />
      </div>
    </header>
  );
}
