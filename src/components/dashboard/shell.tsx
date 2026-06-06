import type { ProjectListItem } from "@/lib/projects/list";
import type { SessionProfile } from "@/lib/supabase/auth";
import type { Theme } from "@/lib/theme";

import { MobileSidebar } from "./mobile-sidebar";
import { ShellProvider } from "./shell-context";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

/**
 * App shell. The root container fills the viewport and never scrolls; the
 * sidebar and topbar stay in place while only the `<main>` element scrolls.
 *
 * The shell is wrapped in `ShellProvider` so the mobile hamburger and the
 * sidebar can coordinate open/close state. Desktop (`md+`) ignores that state
 * and renders the sidebar inline.
 */
export function Shell({
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
          <Sidebar profile={profile} />
        </MobileSidebar>
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar profile={profile} projects={projects} theme={theme} />
          <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 md:px-8 md:py-8">
            {children}
          </main>
        </div>
      </div>
    </ShellProvider>
  );
}
