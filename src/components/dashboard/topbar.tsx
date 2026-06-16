import { NotificationBell } from "@/components/notifications/notification-bell";
import type { ProjectListItem } from "@/lib/projects/list";
import type { SessionProfile } from "@/lib/supabase/auth";
import type { Theme } from "@/lib/theme";

import { ProjectSwitcher } from "./project-switcher";
import { SidebarToggle } from "./sidebar-toggle";
import { UserMenu } from "./user-menu";

export function Topbar({
  profile,
  projects,
  theme,
}: {
  readonly profile: SessionProfile;
  readonly projects: readonly ProjectListItem[];
  readonly theme: Theme;
}) {
  // `ml-auto` on the UserMenu wrapper keeps it pinned right even when
  // ProjectSwitcher renders null (routes where the switcher is hidden).
  // `justify-between` would slide a single child to the left.
  return (
    <header className="flex items-center gap-3 border-b border-border bg-bg-elevated px-4 py-3 sm:gap-4 sm:px-8">
      <SidebarToggle />
      <ProjectSwitcher projects={projects} />
      <div className="ml-auto flex items-center gap-2">
        <NotificationBell />
        <UserMenu profile={profile} theme={theme} />
      </div>
    </header>
  );
}
