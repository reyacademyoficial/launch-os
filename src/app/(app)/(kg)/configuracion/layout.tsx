"use server";

import { KgTabsBar, type TabItem } from "@/components/kg/tabs-bar";
import { requireSessionProfile } from "@/lib/supabase/auth";

/**
 * Layout del módulo Configuración.
 *
 * Accesible para todos los roles (el user-block en el sidebar siempre apunta
 * acá). La pestaña "Mi cuenta" (datos propios + contraseña) la ve cualquier
 * usuario autenticado.
 *
 * Las pestañas de administración (Proyectos, Usuarios, Personas, Distribución)
 * solo aparecen para superadmin y dev. Si un rol sin permiso accede por URL
 * directa a esas rutas, el requireRole de cada página los redirige.
 */
export default async function ConfiguracionLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const profile = await requireSessionProfile();
  const isAdmin = profile.role === "superadmin" || profile.isDevPrivileged;

  const tabs: TabItem[] = [
    { href: "/configuracion", label: "Mi cuenta" },
    ...(isAdmin
      ? [
          { href: "/configuracion/proyectos", label: "Proyectos" },
          { href: "/configuracion/usuarios", label: "Usuarios" },
          { href: "/configuracion/personas", label: "Personas" },
          {
            href: "/configuracion/distribucion",
            label: "Distribución de ingresos",
          },
          { href: "/configuracion/notion", label: "Notion" },
        ]
      : []),
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <KgTabsBar items={tabs} />
      {children}
    </div>
  );
}
