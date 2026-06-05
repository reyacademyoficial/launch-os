import { requireSessionProfile } from "@/lib/supabase/auth";

/**
 * Protected layout — auth defense layer #2.
 *
 * Real chrome (sidebar / topbar / project switcher) lands in Phase 4. For now
 * it's a thin shell that proves the guard runs and that the inner pages render
 * for the logged-in user.
 */
export default async function AppLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const profile = await requireSessionProfile();

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="flex items-center justify-between border-b border-border bg-bg-elevated px-6 py-3">
        <div>
          <span className="text-sm font-semibold text-accent">Launch OS</span>
          <span className="ml-3 text-xs text-fg-subtle">app shell (placeholder)</span>
        </div>
        <div className="text-xs text-fg-muted">
          {profile.fullName ?? profile.email ?? profile.id}{" "}
          <span className="ml-2 rounded bg-surface px-2 py-0.5 text-fg-subtle">
            {profile.role}
          </span>
        </div>
      </header>
      <main className="px-6 py-8">{children}</main>
    </div>
  );
}
