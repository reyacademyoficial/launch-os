import { requireSessionProfile } from "@/lib/supabase/auth";
import { KgTabsBar, type TabItem } from "@/components/kg/tabs-bar";

/**
 * Layout del módulo Clientes. Envuelve el dashboard + las 4 pestañas de
 * datos (tickets, renovaciones, upsells, NPS) con la barra de navegación
 * intra-módulo.
 *
 * La ruta `/clientes/[projectId]` (ficha del cliente) HEREDA este layout —
 * las tabs quedan visibles con "Dashboard" marcado. La ficha muestra su
 * propio contexto arriba y un botón explícito para volver al listado.
 *
 * Gate de rol: hereda de `(app)/layout.tsx` (rechaza cliente_role). No hace
 * falta un requireRole más estricto acá — todo dev/superadmin/analista/
 * operador tiene lectura y escritura sobre la relación con los clientes que
 * gestiona la organización (mismo criterio que Financiero).
 */
export default async function ClientesLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  await requireSessionProfile();

  const tabs: readonly TabItem[] = [
    { href: "/clientes", label: "Dashboard" },
    { href: "/clientes/tickets", label: "Tickets" },
    { href: "/clientes/renovaciones", label: "Renovaciones" },
    { href: "/clientes/upsells", label: "Upsells" },
    { href: "/clientes/nps", label: "NPS" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <KgTabsBar items={tabs} />
      {children}
    </div>
  );
}
