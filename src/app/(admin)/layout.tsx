/**
 * Admin/superadmin guard. Phase 3 wires the server-side role check:
 *   - Read user + role server-side via `createClient` from `@/lib/supabase/server`
 *   - Redirect to `/` (overview) if role is `cliente`
 *
 * This is auth defense layer #2 — middleware is #1, RLS is #3.
 */
export default function AdminLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="border-b border-border bg-bg-elevated px-6 py-3">
        <span className="text-sm font-semibold text-accent">Launch OS · Admin</span>
        <span className="ml-3 text-xs text-fg-subtle">admin shell (placeholder)</span>
      </header>
      <main className="px-6 py-8">{children}</main>
    </div>
  );
}
