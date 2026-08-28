import type { ProjectListItem } from "@/lib/projects/list";
import type { SessionProfile } from "@/lib/supabase/auth";
import type { Theme } from "@/lib/theme";

import { MobileSidebar } from "../dashboard/mobile-sidebar";
import { ShellProvider } from "../dashboard/shell-context";

import { ProjectSidebar } from "./sidebar";
import { ProjectTopbar } from "./topbar";

/**
 * ProjectShell — chasis específico para `/proyectos/[id]/*`.
 *
 * Es el shell histórico de LaunchOS pero renombrado y con dos cambios:
 *   - La sidebar solo lista rutas scoped al proyecto (sin Calculadora, sin
 *     Admin — esas viven en el KingrowShell).
 *   - El topbar suma un botón "← Kingrow" para volver al shell de plataforma.
 *
 * KingrowShell y ProjectShell son mutuamente excluyentes: cuando el usuario
 * está en `/proyectos/[id]/*` ve este shell; cuando sale a Kingrow ve el otro.
 */
export function ProjectShell({
  profile,
  projects,
  theme,
  children,
}: {
  readonly profile: SessionProfile;
  readonly projects: readonly ProjectListItem[];
  readonly theme: Theme;
  readonly children: React.ReactNode;
}) {
  return (
    <ShellProvider>
      <div className="flex h-dvh overflow-hidden bg-bg text-fg">
        <MobileSidebar>
          <ProjectSidebar profile={profile} />
        </MobileSidebar>
        <div className="flex min-w-0 flex-1 flex-col">
          <ProjectTopbar projects={projects} role={profile.role} theme={theme} />
          <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-6 sm:px-6 md:px-8 md:py-8">
            <div className="min-w-0">{children}</div>
          </main>
        </div>
      </div>
    </ShellProvider>
  );
}
