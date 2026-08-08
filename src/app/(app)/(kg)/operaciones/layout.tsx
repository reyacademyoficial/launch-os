import { requireRole } from "@/lib/supabase/auth";
import { KgTabsBar, type TabItem } from "@/components/kg/tabs-bar";

/**
 * Layout del módulo Operaciones. Envuelve el dashboard + las 5 pestañas de
 * datos (Proyectos, Tareas, Bloqueadores, Tiempo, Procesos) con la barra
 * de navegación intra-módulo.
 *
 * La ruta `/operaciones/proyectos/[projectId]` (ficha del internal_project)
 * HEREDA este layout — las tabs quedan visibles con "Proyectos" marcado.
 * La ficha muestra su propio contexto arriba y un botón explícito para
 * volver al listado.
 *
 * Gate de rol: hereda de `(app)/layout.tsx` (rechaza cliente_role). Sin
 * requireRole más estricto acá — todo dev/superadmin/admin/coordinador/operador
 * tiene lectura sobre Operaciones (con filtro "mis tareas" por default,
 * que se maneja en `/operaciones/tareas`).
 */
export default async function OperacionesLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  // Operadores pueden acceder; clientes son redirigidos a /lanzamientos.
  await requireRole("superadmin", "admin", "coordinador", "operador");

  const tabs: readonly TabItem[] = [
    { href: "/operaciones", label: "Dashboard" },
    { href: "/operaciones/proyectos", label: "Proyectos" },
    { href: "/operaciones/tareas", label: "Tareas" },
    { href: "/operaciones/bloqueadores", label: "Bloqueadores" },
    { href: "/operaciones/tiempo", label: "Tiempo" },
    { href: "/operaciones/procesos", label: "Procesos" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <KgTabsBar items={tabs} />
      {children}
    </div>
  );
}
