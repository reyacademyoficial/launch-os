import { requireRole } from "@/lib/supabase/auth";

/**
 * Admin/superadmin guard — auth defense layer #2.
 *
 * Currently allows only superadmin. Both `/proyectos` and `/usuarios` are
 * superadmin-only by spec (admin/cliente delta is intentionally undefined).
 * When admin gains some of these capabilities, loosen this guard and add a
 * page-level `requireRole('superadmin')` to the still-restricted pages.
 */
export default async function AdminLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const profile = await requireRole("superadmin");

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="flex items-center justify-between border-b border-border bg-bg-elevated px-6 py-3">
        <div>
          <span className="text-sm font-semibold text-accent">Launch OS · Admin</span>
          <span className="ml-3 text-xs text-fg-subtle">admin shell (placeholder)</span>
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
