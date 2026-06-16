import { redirect } from "next/navigation";

import { ClientShell } from "@/components/client-portal/client-shell";
import { listAccessibleProjects } from "@/lib/projects/list";
import { requireSessionProfile } from "@/lib/supabase/auth";
import { readThemeCookie } from "@/lib/theme-cookie";

/**
 * Layout protegido del portal del cliente — defensa #2 (auth + role).
 *
 * - requireSessionProfile cubre la presencia de sesión.
 * - El rol se valida explícito: cualquier otro rol cae a "/" (que a su vez
 *   los enruta al shell del equipo). El redirect cruzado evita que un
 *   admin/operador "pase" al portal del cliente accidentalmente y vea una UI
 *   que no es la suya.
 * - La defensa #3 (RLS + cliente_role sin grants a la cocina interna) corre
 *   en Postgres y no depende de este chequeo.
 */
export default async function ClientPortalLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const profile = await requireSessionProfile();
  if (profile.role !== "cliente") redirect("/");

  const [projects, theme] = await Promise.all([
    listAccessibleProjects(),
    readThemeCookie(),
  ]);

  return (
    <ClientShell profile={profile} projects={projects} theme={theme}>
      {children}
    </ClientShell>
  );
}
