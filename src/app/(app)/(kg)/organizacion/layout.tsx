import type { ReactNode } from "react";

import { requireRole } from "@/lib/supabase/auth";

/**
 * Gate a nivel layout — cualquiera que aterrice bajo /organizacion sin ser
 * superadmin cae a "/". Defensa en profundidad: las server actions de esta
 * sección también revalidan requireRole al inicio, y la RLS de las tablas
 * (can_edit_organization) es el último cerrojo.
 *
 * `dev` pasa siempre por el bypass de requireRole. No hay ni siquiera un
 * dropdown de ORG picker en esta versión porque hoy la plataforma tiene una
 * sola organización (Kingrow, id determinista sembrado en 0050). Cuando
 * llegue multi-org habrá que sumar un selector en este layout y propagarlo
 * a las acciones.
 */
export default async function OrganizacionLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  await requireRole("superadmin");
  return <>{children}</>;
}
