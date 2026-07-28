import { redirect } from "next/navigation";

import { requireSessionProfile } from "@/lib/supabase/auth";

/**
 * Protected layout — auth defense layer #2.
 *
 * Ya NO monta shell: la elección KingrowShell vs ProjectShell la hacen los
 * sub-layouts de este árbol:
 *   - `(app)/(kg)/layout.tsx`     → KingrowShell (Ejecutivo, Financiero,
 *     Lanzamientos, Clientes, Operaciones, Academia, Marketing, Calculadora,
 *     Configuración, /dev/auditoria, /admin/*).
 *   - `(app)/proyectos/[projectId]/layout.tsx` → ProjectShell (vista LaunchOS
 *     scopeada al proyecto).
 *
 * Este layout solo gatea autenticación y salta cliente al portal. La razón
 * de mantener el cross-guard acá y no en cada sub-layout: cliente nunca debe
 * ver NADA del árbol `(app)` — ni el shell equipo, ni el shell proyecto.
 * Un solo redirect al top del subárbol es más simple y más seguro que
 * repetirlo en dos lugares.
 */
export default async function AppLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const profile = await requireSessionProfile();
  if (profile.role === "cliente") redirect("/portal");
  return <>{children}</>;
}
