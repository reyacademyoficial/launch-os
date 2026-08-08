import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconOps } from "@/components/kg/icons";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";
import { createClient } from "@/lib/supabase/server";

import type { OwnerOption } from "./internal-project-form-drawer";
import {
  InternalProjectsView,
  type InternalProjectRowData,
} from "./internal-projects-view";

export const metadata: Metadata = { title: "Proyectos internos · Operaciones" };

// ═══════════════════════════════════════════════════════════════════════════
// Lista de proyectos internos.
//
// Filtros por searchParams:
//   ?status=activos|cerrados|todos    default activos
//                                      (activos = backlog + active + paused;
//                                       cerrados = done + archived)
// ═══════════════════════════════════════════════════════════════════════════

type Status = "backlog" | "active" | "paused" | "done" | "archived";
type Priority = "low" | "med" | "high" | "urgent";

type StatusFilter = "activos" | "cerrados" | "todos";

const STATUS_FILTER_OPTIONS: ReadonlyArray<{
  value: StatusFilter;
  label: string;
}> = [
  { value: "activos", label: "Activos" },
  { value: "cerrados", label: "Cerrados" },
  { value: "todos", label: "Todos" },
];

const OPEN_STATUSES: ReadonlySet<Status> = new Set([
  "backlog",
  "active",
  "paused",
]);

interface ProjectDbRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: Status;
  readonly priority: Priority;
  readonly owner_id: string | null;
  readonly starts_on: string | null;
  readonly due_on: string | null;
  readonly closed_at: string | null;
  readonly notes: string | null;
}

interface PersonDbRow {
  readonly id: string;
  readonly full_name: string;
  readonly active: boolean;
}

interface TaskProgressRow {
  readonly internal_project_id: string | null;
  readonly status: "todo" | "doing" | "blocked" | "done" | "cancelled";
}

export default async function ProyectosInternosPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const statusFilter = parseStatus(sp.status);

  const supabase = await createClient();

  const [projectsRes, peopleRes, tasksRes] = await Promise.all([
    supabase
      .from("internal_projects")
      .select(
        "id, name, description, status, priority, owner_id, starts_on, due_on, closed_at, notes",
      )
      .order("status", { ascending: true })
      .order("due_on", { ascending: true, nullsFirst: false })
      .order("name", { ascending: true }),
    supabase
      .from("organization_people")
      .select("id, full_name, active")
      .order("full_name", { ascending: true }),
    // Progreso: solo necesitamos status + project id. Tareas huérfanas
    // (internal_project_id null) se descartan en el agregado.
    supabase
      .from("tasks")
      .select("internal_project_id, status")
      .not("internal_project_id", "is", null),
  ]);

  const allProjects =
    (projectsRes.data ?? []) as unknown as ProjectDbRow[];
  const allPeople = (peopleRes.data ?? []) as unknown as PersonDbRow[];
  const allTasks = (tasksRes.data ?? []) as unknown as TaskProgressRow[];

  const personNameById = new Map<string, string>();
  for (const p of allPeople) personNameById.set(p.id, p.full_name);

  const owners: OwnerOption[] = allPeople
    .filter((p) => p.active)
    .map((p) => ({ id: p.id, fullName: p.full_name }));

  // Agrego total y done por project_id en un pase.
  const tasksTotalByProject = new Map<string, number>();
  const tasksDoneByProject = new Map<string, number>();
  const tasksOpenByProject = new Map<string, number>();
  for (const t of allTasks) {
    if (!t.internal_project_id) continue;
    tasksTotalByProject.set(
      t.internal_project_id,
      (tasksTotalByProject.get(t.internal_project_id) ?? 0) + 1,
    );
    if (t.status === "done") {
      tasksDoneByProject.set(
        t.internal_project_id,
        (tasksDoneByProject.get(t.internal_project_id) ?? 0) + 1,
      );
    }
    if (t.status === "todo" || t.status === "doing" || t.status === "blocked") {
      tasksOpenByProject.set(
        t.internal_project_id,
        (tasksOpenByProject.get(t.internal_project_id) ?? 0) + 1,
      );
    }
  }

  const filtered = allProjects.filter((p) => {
    if (statusFilter === "activos") return OPEN_STATUSES.has(p.status);
    if (statusFilter === "cerrados") return !OPEN_STATUSES.has(p.status);
    return true;
  });

  const rows: InternalProjectRowData[] = filtered.map((p) => {
    const total = tasksTotalByProject.get(p.id) ?? 0;
    const done = tasksDoneByProject.get(p.id) ?? 0;
    const open = tasksOpenByProject.get(p.id) ?? 0;
    const progressPct = total > 0 ? Math.round((done / total) * 100) : null;
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      status: p.status,
      priority: p.priority,
      ownerId: p.owner_id,
      ownerName: p.owner_id ? personNameById.get(p.owner_id) ?? null : null,
      startsOn: p.starts_on,
      dueOn: p.due_on,
      closedAt: p.closed_at,
      notes: p.notes,
      progressPct,
      openTasksCount: open,
    };
  });

  const totalCount = allProjects.length;
  const openCount = allProjects.filter((p) => OPEN_STATUSES.has(p.status))
    .length;
  const pausedCount = allProjects.filter((p) => p.status === "paused").length;
  const backlogCount = allProjects.filter((p) => p.status === "backlog").length;

  function buildHref(nextStatus: StatusFilter): string {
    const params = new URLSearchParams();
    if (nextStatus !== "activos") params.set("status", nextStatus);
    const qs = params.toString();
    return qs ? `/operaciones/proyectos?${qs}` : "/operaciones/proyectos";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconOps size={16} />}
        title="Proyectos internos"
        stats={[
          { l: "Total", v: fCount(totalCount) },
          { l: "Abiertos", v: fCount(openCount) },
          { l: "En pausa", v: fCount(pausedCount) },
          { l: "Backlog", v: fCount(backlogCount) },
        ]}
      />

      <KgParamPills
        ariaLabel="Filtrar por estado"
        options={STATUS_FILTER_OPTIONS.map((o) => ({
          label: o.label,
          href: buildHref(o.value),
          active: statusFilter === o.value,
        }))}
      />

      <Panel title="Proyectos internos">
        <InternalProjectsView
          rows={rows}
          totalCount={rows.length}
          owners={owners}
        />
      </Panel>
    </div>
  );
}

function parseStatus(v: string | string[] | undefined): StatusFilter {
  if (typeof v !== "string") return "activos";
  if (v === "cerrados" || v === "todos") return v;
  return "activos";
}
