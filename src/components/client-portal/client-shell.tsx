import type { SessionProfile } from "@/lib/supabase/auth";
import type { Theme } from "@/lib/theme";

import { MobileSidebar } from "../dashboard/mobile-sidebar";
import { ShellProvider } from "../dashboard/shell-context";

import { ClientSidebar } from "./client-sidebar";
import { ClientTopbar } from "./client-topbar";

interface Project {
  id: string;
  name: string;
}

/**
 * Shell del portal del cliente. Mismo chasis que el shell del equipo
 * (ShellProvider + MobileSidebar + topbar + main scrollable) pero con
 * navegación y switcher dedicados — la URL queda completamente en
 * `/portal/…`, sin mezclarse con `/proyectos/…` o `/admin/…`.
 */
export function ClientShell({
  profile,
  projects,
  theme,
  children,
}: {
  readonly profile: SessionProfile;
  readonly projects: readonly Project[];
  readonly theme: Theme;
  readonly children: React.ReactNode;
}) {
  return (
    <ShellProvider>
      <div className="flex h-dvh overflow-hidden bg-bg text-fg">
        <MobileSidebar>
          <ClientSidebar />
        </MobileSidebar>
        <div className="flex min-w-0 flex-1 flex-col">
          <ClientTopbar profile={profile} projects={projects} theme={theme} />
          <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 md:px-8 md:py-8">
            {children}
          </main>
        </div>
      </div>
    </ShellProvider>
  );
}
