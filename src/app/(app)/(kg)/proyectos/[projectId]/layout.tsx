import { redirect } from "next/navigation";

import { KgProjectNav } from "@/components/kg/project-nav";
import type { TabItem } from "@/components/kg/tabs-bar";
import { listAccessibleProjects } from "@/lib/projects/list";
import { requireSessionProfile } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Layout del módulo Lanzamientos scopeado a un proyecto.
 *
 * Vive dentro del route group `(kg)`, así que hereda el `KingrowShell` de
 * `(kg)/layout.tsx` — la sidebar Kingrow queda visible siempre. El route
 * group no aparece en la URL: las rutas siguen siendo `/proyectos/[id]/…`.
 *
 * Antes acá se montaba el `ProjectShell` (sidebar + topbar propias, herencia
 * de cuando LaunchOS era un programa aparte). Ese chasis se borró: lo que era
 * su sidebar ahora son las pestañas de `KgProjectNav`, mismo patrón que
 * `(kg)/financiero/layout.tsx`.
 *
 * Guard (RLS layer #2): un usuario no autorizado que tipea
 * `/proyectos/<other-id>/…` es redirigido a `/` en lugar de ver una page
 * vacía (RLS oculta todo). Útil por UX y como no-disclosure de IDs.
 *
 * Las pestañas se derivan del rol EN EL SERVIDOR — si un rol no debería ver
 * una ruta, la pestaña no se emite. Mismo criterio que tenía la sidebar del
 * ProjectShell; los gates reales siguen viviendo en cada page y en RLS.
 */
interface ProjectRow {
  readonly id: string;
  readonly name: string;
}

export default async function ProjectLayout({
  children,
  params,
}: {
  readonly children: React.ReactNode;
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();
  // El cast es el patrón del repo: la inferencia de postgrest-js colapsa a
  // `never` con este Database generado (ver `financiero/gastos/page.tsx`).
  const { data } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .maybeSingle();
  const project = data as unknown as ProjectRow | null;

  if (!project) redirect("/");

  const [profile, projects] = await Promise.all([
    requireSessionProfile(),
    listAccessibleProjects(),
  ]);

  const base = `/proyectos/${projectId}`;
  const isOperador = profile.role === "operador";
  const isCloser = profile.role === "closer";

  // Reglas heredadas de la sidebar del ProjectShell:
  //   operador → sin Overview (no ve KPIs agregados del proyecto)
  //   closer   → SOLO Ventas + Cobros
  //
  // Leads y Auditoría se sacaron del menú (decisión de producto, no técnica):
  // las rutas `/leads` y `/audit` y todo su código siguen intactos — solo
  // dejaron de listarse como pestañas. Quien tenga el link directo (ej. el
  // kanban linkeando a `/leads` desde otro lado) sigue entrando normal.
  const tabs: readonly TabItem[] = isCloser
    ? [
        { href: `${base}/ventas`, label: "Ventas" },
        { href: `${base}/cobros`, label: "Cobros" },
      ]
    : [
        ...(isOperador ? [] : [{ href: base, label: "Overview" }]),
        { href: `${base}/launches`, label: "Lanzamientos" },
        { href: `${base}/analitica`, label: "Analítica" },
        { href: `${base}/ventas`, label: "Ventas" },
        { href: `${base}/cobros`, label: "Cobros" },
      ];

  return (
    // h-full + min-h-0 permite a las pages con tablas aplicar `flex-1 min-h-0`
    // a su Panel para llenar lo que quede del viewport sin offsets fijos
    // `calc(100vh - Xpx)`. Mismo patrón que el layout de Financiero.
    //
    // ⚠ REGLA PARA LAS PAGES DE ESTE ÁRBOL — el root de cada page elige entre
    // dos wrappers, y elegir mal RECORTA contenido:
    //
    //   · `flex h-full min-h-0 flex-col gap-5` → SOLO si la page usa
    //     `Panel fillHeight` + `KgDataTable fillHeight`. La tabla llena el
    //     viewport y scrollea internamente (ej: `audit/page.tsx`).
    //
    //   · `flex flex-col gap-5` → todo lo demás. Una page de flujo largo
    //     (bento de KPIs + panel debajo) con `h-full min-h-0` queda clavada a
    //     la altura del viewport y lo que sobra NO suma a `main.scrollHeight`:
    //     el contenido de abajo se vuelve inalcanzable. Le pasó al Overview.
    //     El dashboard de Financiero usa este wrapper, sin `h-full`.
    <div className="flex h-full min-h-0 flex-col gap-4">
      <KgProjectNav
        items={tabs}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        activeId={projectId}
        activeName={project.name}
      />
      {children}
    </div>
  );
}
