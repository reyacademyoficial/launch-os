import { KingrowShell } from "@/components/kg/shell";
import { requireSessionProfile } from "@/lib/supabase/auth";
import { readThemeCookie } from "@/lib/theme-cookie";

/**
 * Shell Kingrow — chasis de plataforma para roles no-cliente. Se monta sobre
 * el árbol de módulos de empresa y utilidades (todo lo que NO es `/proyectos/*`).
 *
 * El gate cliente vive en `(app)/layout.tsx` — acá ya sabemos que llegó un
 * usuario no-cliente. Sigue habiendo un `requireSessionProfile` para tener
 * el profile disponible localmente (Next dedupe la query dentro del mismo
 * request).
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
