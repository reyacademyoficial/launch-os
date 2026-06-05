import { Shell } from "@/components/dashboard/shell";
import { requireRole } from "@/lib/supabase/auth";

/**
 * Admin guard — auth defense layer #2.
 *
 * Currently superadmin-only (admin/cliente delta intentionally undefined).
 * When admin gains some of these capabilities, loosen this guard and add a
 * page-level `requireRole('superadmin')` to the still-restricted pages.
 *
 * Uses the same <Shell> as the (app) group so navigation stays coherent.
 */
export default async function AdminLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const profile = await requireRole("superadmin");
  return <Shell profile={profile}>{children}</Shell>;
}
