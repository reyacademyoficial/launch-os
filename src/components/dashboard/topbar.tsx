import { signOut } from "@/lib/auth/actions";
import type { SessionProfile } from "@/lib/supabase/auth";
import type { ProjectListItem } from "@/lib/projects/list";

import { ProjectSwitcher } from "./project-switcher";

export function Topbar({
  profile,
  projects,
}: {
  readonly profile: SessionProfile;
  readonly projects: readonly ProjectListItem[];
}) {
  const label = profile.fullName ?? profile.email ?? profile.id;

  return (
    <header className="flex items-center justify-between gap-4 border-b border-border bg-bg-elevated px-8 py-3">
      <ProjectSwitcher projects={projects} />

      <div className="flex items-center gap-4">
        <div className="text-right text-xs leading-tight">
          <div className="text-fg">{label}</div>
          <div className="text-fg-subtle">{profile.role}</div>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-bg hover:text-fg"
          >
            Salir
          </button>
        </form>
      </div>
    </header>
  );
}
