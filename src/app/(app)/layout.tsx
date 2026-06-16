import { redirect } from "next/navigation";

import { Shell } from "@/components/dashboard/shell";
import { listAccessibleProjects } from "@/lib/projects/list";
import { requireSessionProfile } from "@/lib/supabase/auth";
import { readThemeCookie } from "@/lib/theme-cookie";

/**
 * Protected layout — auth defense layer #2 + the app chrome.
 * Real navigation lives in <Shell>; this file gates, fetches accessible
 * projects (for the topbar switcher), and forwards.
 *
 * Cliente queda fuera del shell del equipo: tiene su propio shell bajo
 * `(cliente)/portal/…`. El redirect acá garantiza que un cliente que tipea
 * cualquier URL del equipo aterrice en su portal en lugar de ver una UI a
 * medio renderizar (la barrera dura igual es DB — cliente_role sin grants).
 */
export default async function AppLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const profile = await requireSessionProfile();
  if (profile.role === "cliente") redirect("/portal");

  const [projects, theme] = await Promise.all([
    listAccessibleProjects(),
    readThemeCookie(),
  ]);
  return (
    <Shell profile={profile} projects={projects} theme={theme}>
      {children}
    </Shell>
  );
}
