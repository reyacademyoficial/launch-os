import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconAca } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { listAllExternalApps } from "@/lib/academia/external-apps";
import { getPropiaProjects } from "@/lib/academia/reference";
import { requireRole } from "@/lib/supabase/auth";

import { NewAppButton } from "./new-app-button";
import { AppsExternasView, type AppRow, type ProjectOption } from "./view";

export const metadata: Metadata = { title: "Apps externas · Academia" };

/**
 * CRUD de external_apps del proyecto (Fase G · 0153). Visible para
 * superadmin / admin / coordinador. Operador y cliente son redirigidos por
 * requireRole heredado del layout — acá re-gateamos por defensa.
 *
 * Solo listamos proyectos con ownership='propia' porque el guard de la tabla
 * los rechaza (guard_propia_project → check_violation 23514).
 */
export default async function AppsExternasPage() {
  await requireRole("superadmin", "admin", "coordinador");

  const [projects, apps] = await Promise.all([
    getPropiaProjects(),
    listAllExternalApps(),
  ]);

  const nameByProject = new Map<string, string>();
  for (const p of projects) nameByProject.set(p.id, p.name);

  const rows: AppRow[] = apps.map((a) => ({
    id: a.id,
    projectId: a.project_id,
    projectName: nameByProject.get(a.project_id) ?? "—",
    name: a.name,
    baseUrl: a.base_url,
    active: a.active,
  }));

  const projectOptions: ProjectOption[] = projects.map((p) => ({
    id: p.id,
    name: p.name,
  }));

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <ContextBar
        icon={<IconAca size={16} />}
        title="Apps externas"
        stats={[
          { l: "Registradas", v: String(rows.length) },
          {
            l: "Activas",
            v: String(rows.filter((r) => r.active).length),
          },
          { l: "Proyectos propios", v: String(projects.length) },
        ]}
      />

      <Panel
        title="Apps configuradas"
        pad={false}
        fillHeight
        actions={<NewAppButton projectOptions={projectOptions} />}
      >
        <AppsExternasView rows={rows} projectOptions={projectOptions} />
      </Panel>
    </div>
  );
}
