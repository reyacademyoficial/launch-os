/**
 * Protected layout. Phase 3 wires:
 *   1. Server-side session check via `createClient` from `@/lib/supabase/server`
 *   2. Redirect to `/login` if no session (defense layer #2; middleware is layer #1)
 *   3. Sidebar + topbar with the active project context
 *
 * Phase 1 is a pass-through with shell chrome so the structure renders.
 */
export default function AppLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="border-b border-border bg-bg-elevated px-6 py-3">
        <span className="text-sm font-semibold text-accent">Launch OS</span>
        <span className="ml-3 text-xs text-fg-subtle">app shell (placeholder)</span>
      </header>
      <main className="px-6 py-8">{children}</main>
    </div>
  );
}
