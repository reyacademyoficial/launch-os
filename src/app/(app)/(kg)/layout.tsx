import { KingrowShell } from "@/components/kg/shell";
import { requireSessionProfile } from "@/lib/supabase/auth";
import { readThemeCookie } from "@/lib/theme-cookie";

/**
 * Shell Kingrow — chasis único de la plataforma. Se monta sobre TODO el árbol
 * de módulos de empresa y utilidades, `/proyectos/*` incluido: al unificar
 * Lanzamientos al KG System el `ProjectShell` (sidebar + topbar propias,
 * herencia de cuando LaunchOS era un programa aparte) se borró, y la carpeta
 * `proyectos/` se movió dentro de este route group. Los route groups no
 * aparecen en la URL, así que las rutas siguen siendo `/proyectos/[id]/…`.
 *
 * NO hay gate de rol acá — este layout solo hace `requireSessionProfile` para
 * tener el profile disponible localmente (Next dedupe la query dentro del
 * mismo request). `cliente`, `closer` y `operador` SÍ montan este shell; lo
 * que ven se recorta en `KgSidebar` vía `ROLE_MODULE_ALLOWLIST` (layers.ts) y
 * cada módulo aplica su propio `requireRole` / gate de capacidad.
 */
export default async function KingrowLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const [profile, theme] = await Promise.all([
    requireSessionProfile(),
    readThemeCookie(),
  ]);
  return (
    <KingrowShell profile={profile} theme={theme}>
      {children}
    </KingrowShell>
  );
}
