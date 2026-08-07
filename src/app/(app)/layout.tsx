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
 * Este layout sólo gatea autenticación. El gating de rol ocurre en cada
 * módulo individual — eso permite que `cliente` llegue a `/lanzamientos` y
 * a `/proyectos/[id]/*` sin bloquearse en este árbol. Ver `requireRole` en
 * auth.ts: los roles restringidos redirigen al destino correcto según su rol
 * (cliente → /lanzamientos, operador → /operaciones).
 */
export default async function AppLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  await requireSessionProfile();
  return <>{children}</>;
}
