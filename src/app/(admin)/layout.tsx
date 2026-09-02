import { KingrowShell } from "@/components/kg/shell";
import { readSidebarCollapsedCookie } from "@/lib/sidebar-cookie";
import { requireRole } from "@/lib/supabase/auth";
import { readThemeCookie } from "@/lib/theme-cookie";

/**
 * Admin guard — auth defense layer #2.
 *
 * Superadmin-only (dev pasa por bypass del helper). Se monta dentro del
 * KingrowShell — el sidebar KG resalta "Proyectos" o "Usuarios" en la
 * sección "Sistema" cuando estás acá.
 */
export default async function AdminLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const profile = await requireRole("superadmin");
  const theme = await readThemeCookie();
  const sidebarCollapsed = await readSidebarCollapsedCookie();
  return (
    <KingrowShell profile={profile} theme={theme} sidebarCollapsed={sidebarCollapsed}>
      {children}
    </KingrowShell>
  );
}
