import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconAca } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { listAllExternalApps } from "@/lib/academia/external-apps";
import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

import { AppsExternasView, type AppRow, type ProjectOption } from "./view";

export const metadata: Metadata = { title: "Apps externas · Academia" };

interface ProjectRow {
  readonly id: string;
  readonly name: string;
}

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

  const supabase = await createClient();
  const projectsRes = await supabase
    .from("projects")
    .select("id, name")
    .eq("ownership", "propia")
    .order("name", { ascending: true });
  const projects = (projectsRes.data ?? []) as unknown as ProjectRow[];

  const apps = await listAllExternalApps();

  const nameByProject = new Map<string, string>();
  for (const p of projects) nameByProject.set(p.id, p.name);

  const rows: AppRow[] = apps.map((a) => ({
    id: a.id,
    projectId: a.project_id,
    projectName: nameByProject.get(a.project_id) ?? "—",
    name: a.name,
    baseUrl: a.base_url,
    authStrategy: a.auth_strategy,
    active: a.active,
    config: a.config,
  }));

  const projectOptions: ProjectOption[] = projects.map((p) => ({
    id: p.id,
    name: p.name,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
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

      <Panel title="Apps configuradas">
        <AppsExternasView
          rows={rows}
          projectOptions={projectOptions}
        />
      </Panel>
    </div>
  );
}
