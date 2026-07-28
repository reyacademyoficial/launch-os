import Link from "next/link";

import { NotificationBell } from "@/components/notifications/notification-bell";
import type { ProjectListItem } from "@/lib/projects/list";
import type { SessionProfile } from "@/lib/supabase/auth";
import type { Theme } from "@/lib/theme";

import { ProjectSwitcher } from "../dashboard/project-switcher";
import { SidebarToggle } from "../dashboard/sidebar-toggle";
import { UserMenu } from "../dashboard/user-menu";
import { IconArrowLeft } from "../kg/icons";

/**
 * ProjectShell · Topbar.
 *
 * Suma un botón "← Kingrow" al principio para volver al shell de la
 * plataforma. El resto es idéntico al topbar viejo (project switcher,
 * notification bell, user menu con theme + config + logout).
 */
export function ProjectTopbar({
  profile,
  projects,
  theme,
}: {
  readonly profile: SessionProfile;
  readonly projects: readonly ProjectListItem[];
  readonly theme: Theme;
}) {
  return (
    <header className="flex items-center gap-3 border-b border-border bg-bg-elevated px-4 py-3 sm:gap-4 sm:px-8">
      <SidebarToggle />
      <Link
        href="/"
        className="flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium text-fg-muted transition-colors hover:border-accent hover:text-fg"
      >
        <IconArrowLeft size={14} />
        <span>Kingrow</span>
      </Link>
      <ProjectSwitcher projects={projects} />
      <div className="ml-auto flex items-center gap-2">
        <NotificationBell />
        <UserMenu profile={profile} theme={theme} />
      </div>
    </header>
  );
}
