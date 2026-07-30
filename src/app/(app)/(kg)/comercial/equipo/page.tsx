import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconOrg } from "@/components/kg/icons";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";
import { listAccessibleProjects } from "@/lib/projects/list";
import { createClient } from "@/lib/supabase/server";
import { listAllTeamMembers } from "@/lib/team/list";
import type { TeamMemberRole } from "@/lib/team/types";

import { EquipoView, type TeamMemberRowData } from "./equipo-view";
import type { ProjectOption } from "./team-member-form-drawer";

export const metadata: Metadata = { title: "Equipo · Comercial" };

type ActiveParam = "activos" | "inactivos" | "todos";

const ACTIVE_OPTIONS: ReadonlyArray<{ value: ActiveParam; label: string }> = [
  { value: "activos", label: "Activos" },
  { value: "inactivos", label: "Dados de baja" },
  { value: "todos", label: "Todos" },
];

type RoleFilterParam = TeamMemberRole | "todos";

const ROLE_FILTER_OPTIONS: ReadonlyArray<{
  value: RoleFilterParam;
  label: string;
}> = [
  { value: "todos", label: "Todos los roles" },
  { value: "setter", label: "Setters" },
  { value: "closer", label: "Closers" },
  { value: "media_buyer", label: "Media buyers" },
  { value: "manager", label: "Managers" },
  { value: "otro", label: "Otros" },
];

interface SaleCountRow {
  readonly setter_id: string | null;
  readonly closer_id: string | null;
}

export default async function EquipoPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const activeParam = parseActive(sp.state);
  const roleParam = parseRole(sp.role);
  const projectFilter =
    typeof sp.project === "string" && sp.project.trim().length > 0
      ? sp.project
      : null;

  const supabase = await createClient();
  const [members, projects, salesRes] = await Promise.all([
    listAllTeamMembers(),
    listAccessibleProjects(),
    // Conteo de ventas por miembro — un miembro puede figurar como setter
    // o closer en una venta (0014 schema). Sumamos ambas contribuciones.
    supabase.from("sales").select("setter_id, closer_id"),
  ]);
  const sales = (salesRes.data ?? []) as unknown as SaleCountRow[];

  const salesByMemberId = new Map<string, number>();
  for (const s of sales) {
    if (s.setter_id) {
      salesByMemberId.set(
        s.setter_id,
        (salesByMemberId.get(s.setter_id) ?? 0) + 1,
      );
    }
    if (s.closer_id && s.closer_id !== s.setter_id) {
      salesByMemberId.set(
        s.closer_id,
        (salesByMemberId.get(s.closer_id) ?? 0) + 1,
      );
    }
  }

  const projectById = new Map(projects.map((p) => [p.id, p]));

  const filtered = members.filter((m) => {
    if (activeParam === "activos" && !m.active) return false;
    if (activeParam === "inactivos" && m.active) return false;
    if (roleParam !== "todos" && m.role !== roleParam) return false;
    if (projectFilter && m.project_id !== projectFilter) return false;
    return true;
  });

  const rows: TeamMemberRowData[] = filtered.map((m) => {
    const project = projectById.get(m.project_id);
    return {
      id: m.id,
      projectId: m.project_id,
      projectName: project?.name ?? "—",
      name: m.name,
      role: m.role,
      commissionRate: m.commission_rate,
      salesCount: salesByMemberId.get(m.id) ?? 0,
      active: m.active,
    };
  });

  const totalCount = rows.length;
  const totalActive = rows.filter((r) => r.active).length;
  const totalSalesShown = rows.reduce((a, r) => a + r.salesCount, 0);

  const projectsForDrawer: ProjectOption[] = projects.map((p) => ({
    id: p.id,
    name: p.name,
  }));

  const projectsWithMembers = new Set(members.map((m) => m.project_id));
  const projectPillOptions = [
    {
      label: "Todos los proyectos",
      href: buildHref({ state: activeParam, role: roleParam, project: null }),
      active: projectFilter == null,
    },
    ...projects
      .filter((p) => projectsWithMembers.has(p.id))
      .map((p) => ({
        label: p.name,
        href: buildHref({
          state: activeParam,
          role: roleParam,
          project: p.id,
        }),
        active: projectFilter === p.id,
      })),
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconOrg size={16} />}
        title="Equipo de ventas"
        stats={[
          { l: "En la vista", v: fCount(totalCount) },
          { l: "Activos", v: fCount(totalActive) },
          { l: "Ventas asociadas", v: fCount(totalSalesShown) },
        ]}
      />

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <KgParamPills
          ariaLabel="Filtrar por estado"
          options={ACTIVE_OPTIONS.map((o) => ({
            label: o.label,
            href: buildHref({
              state: o.value,
              role: roleParam,
              project: projectFilter,
            }),
            active: activeParam === o.value,
          }))}
        />
        <KgParamPills
          ariaLabel="Filtrar por rol"
          options={ROLE_FILTER_OPTIONS.map((o) => ({
            label: o.label,
            href: buildHref({
              state: activeParam,
              role: o.value,
              project: projectFilter,
            }),
            active: roleParam === o.value,
          }))}
        />
        {projectPillOptions.length > 1 && (
          <KgParamPills
            ariaLabel="Filtrar por proyecto"
            options={projectPillOptions}
          />
        )}
      </div>

      <Panel title="Miembros del equipo" pad={false}>
        <EquipoView
          rows={rows}
          totalCount={totalCount}
          projects={projectsForDrawer}
        />
      </Panel>
    </div>
  );
}

function parseActive(v: string | string[] | undefined): ActiveParam {
  if (typeof v !== "string") return "activos";
  const allowed: ActiveParam[] = ["activos", "inactivos", "todos"];
  return (allowed as string[]).includes(v) ? (v as ActiveParam) : "activos";
}

function parseRole(v: string | string[] | undefined): RoleFilterParam {
  if (typeof v !== "string") return "todos";
  const allowed: RoleFilterParam[] = [
    "todos",
    "setter",
    "closer",
    "media_buyer",
    "manager",
    "otro",
  ];
  return (allowed as string[]).includes(v)
    ? (v as RoleFilterParam)
    : "todos";
}

function buildHref(overrides: {
  state: ActiveParam;
  role: RoleFilterParam;
  project: string | null;
}): string {
  const params = new URLSearchParams();
  if (overrides.state !== "activos") params.set("state", overrides.state);
  if (overrides.role !== "todos") params.set("role", overrides.role);
  if (overrides.project) params.set("project", overrides.project);
  const qs = params.toString();
  return qs ? `/comercial/equipo?${qs}` : "/comercial/equipo";
}
