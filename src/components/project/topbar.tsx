import Link from "next/link";

import { NotificationBell } from "@/components/notifications/notification-bell";
import type { ProjectListItem } from "@/lib/projects/list";
import type { Theme } from "@/lib/theme";

import { ProjectSwitcher } from "../dashboard/project-switcher";
import { SidebarToggle } from "../dashboard/sidebar-toggle";
import { IconArrowLeft } from "../kg/icons";
import { KgThemeToggle } from "../kg/theme-toggle";

/**
 * ProjectShell · Topbar.
 *
 * Suma un botón "← Kingrow" al principio para volver al shell de la
 * plataforma. A la derecha: notification bell + toggle de tema (mismo que
 * Kingrow). El acceso a cuenta/config/logout ahora vive en el `KgUserBlock`
 * al pie del sidebar — no queremos duplicar la superficie.
 */
export function ProjectTopbar({
  projects,
  theme,
}: {
  readonly projects: readonly ProjectListItem[];
  readonly theme: Theme;
}) {
  return (
    <header className="flex items-center gap-3 border-b border-border bg-bg-elevated px-4 py-3 sm:gap-4 sm:px-8">
      <SidebarToggle />
      {/*
        En mobile el link "← Kingrow" vive dentro del drawer del sidebar
        (ver ProjectSidebar). Acá queda solo en `md+` para no comerle espacio
        al ProjectSwitcher, que es la acción central de la topbar.
      */}
      <Link
        href="/"
        className="hidden items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium text-fg-muted transition-colors hover:border-accent hover:text-fg md:flex"
      >
        <IconArrowLeft size={14} />
        <span>Kingrow</span>
      </Link>
      <ProjectSwitcher projects={projects} />
      <div className="ml-auto flex items-center gap-2">
        <NotificationBell />
        <KgThemeToggle theme={theme} />
      </div>
    </header>
  );
}
