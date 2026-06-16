import type { SessionProfile } from "@/lib/supabase/auth";
import type { Theme } from "@/lib/theme";

import { SidebarToggle } from "../dashboard/sidebar-toggle";
import { UserMenu } from "../dashboard/user-menu";

import { ClientProjectSwitcher } from "./client-project-switcher";

interface Project {
  id: string;
  name: string;
}

/**
 * Topbar del portal del cliente. Reusa SidebarToggle y UserMenu (parametrizado
 * con `configHref`), cambia el switcher por el dedicado del portal.
 */
export function ClientTopbar({
  profile,
  projects,
  theme,
}: {
  readonly profile: SessionProfile;
  readonly projects: readonly Project[];
  readonly theme: Theme;
}) {
  return (
    <header className="flex items-center gap-3 border-b border-border bg-bg-elevated px-4 py-3 sm:gap-4 sm:px-8">
      <SidebarToggle />
      <ClientProjectSwitcher projects={projects} />
      <div className="ml-auto">
        <UserMenu profile={profile} theme={theme} configHref="/portal/configuracion" />
      </div>
    </header>
  );
}
