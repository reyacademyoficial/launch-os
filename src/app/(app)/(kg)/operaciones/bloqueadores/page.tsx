import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import { IconOps } from "@/components/kg/icons";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { resolveCurrentPersonId } from "@/lib/ops/current-person";
import { fCount } from "@/lib/finance/format";
import { requireSessionProfile } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

import type {
  PersonOptionForBlocker,
  ProjectOptionForBlocker,
  TaskOptionForBlocker,
} from "./blocker-form-drawer";
import { BlockersView, type BlockerRowData } from "./blockers-view";

export const metadata: Metadata = { title: "Bloqueadores · Operaciones" };

// ═══════════════════════════════════════════════════════════════════════════
// Vista global de bloqueadores.
//
// Filtros por searchParams:
//   ?scope=mine|all                   default mine (TODOS los roles).
//                                     "mine" filtra a bloqueadores donde la
//                                     task tiene a mi persona como assignee,
//                                     o el proyecto tiene a mi persona como
//                                     owner. Toggle siempre visible.
//   ?status=abiertos|resueltos|todos  default abiertos
//
// Antigüedad calculada server-side (opened_at → hoy). Se pinta ámbar a
// los 3+ días y rojo a los 7+ días.
// ═══════════════════════════════════════════════════════════════════════════

type Scope = "mine" | "all";
type StatusFilter = "abiertos" | "resueltos" | "todos";

const STATUS_FILTER_OPTIONS: ReadonlyArray<{
  value: StatusFilter;
  label: string;
}> = [
  { value: "abiertos", label: "Abiertos" },
  { value: "resueltos", label: "Resueltos" },
  { value: "todos", label: "Todos" },
];

interface BlockerDbRow {
  readonly id: string;
  readonly task_id: string | null;
  readonly internal_project_id: string | null;
  readonly reason: string;
  readonly opened_at: string;
  readonly resolved_at: string | null;
  readonly resolved_by: string | null;
}

type OpStatus =
  | "sin_empezar"
  | "en_proceso"
  | "bloqueado"
  | "alerta_maxima"
  | "listo";

interface TaskDbRow {
  readonly id: string;
  readonly title: string;
  readonly internal_project_id: string | null;
  readonly status: OpStatus;
}

interface ProjectDbRow {
  readonly id: string;
  readonly name: string;
  readonly status: OpStatus;
}

interface PersonDbRow {
  readonly id: string;
  readonly full_name: string;
  readonly active: boolean;
}

export default async function BloqueadoresPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp] = await Promise.all([requireSessionProfile(), searchParams]);
  const scope: Scope = sp.scope === "all" ? "all" : "mine";
  const isScopedToMe = scope === "mine";
  const statusFilter = parseStatus(sp.status);

  const currentPersonId = isScopedToMe ? await resolveCurrentPersonId() : null;
  const showPersonMissing = isScopedToMe && currentPersonId == null;

  const supabase = await createClient();

  const [
    blockersRes,
    tasksRes,
    projectsRes,
    peopleRes,
    taskAssigneesRes,
    projectOwnersRes,
  ] = await Promise.all([
    supabase
      .from("blockers")
      .select(
        "id, task_id, internal_project_id, reason, opened_at, resolved_at, resolved_by",
      )
      .order("resolved_at", { ascending: true, nullsFirst: true })
      .order("opened_at", { ascending: false }),
    supabase
      .from("tasks")
      .select("id, title, internal_project_id, status"),
    supabase
      .from("internal_projects")
      .select("id, name, status")
      .neq("status", "listo")
      .order("name", { ascending: true }),
    supabase
      .from("organization_people")
      .select("id, full_name, active")
      .order("full_name", { ascending: true }),
    // Junctions para scope=mine: qué tasks tengo asignadas + qué proyectos
    // tengo como owner. Con eso filtramos los blockers linkeados.
    isScopedToMe && currentPersonId != null
      ? supabase
          .from("task_assignees")
          .select("task_id")
          .eq("person_id", currentPersonId)
      : Promise.resolve({ data: [] as Array<{ task_id: string }> }),
    isScopedToMe && currentPersonId != null
      ? supabase
          .from("internal_project_owners")
          .select("internal_project_id")
          .eq("person_id", currentPersonId)
      : Promise.resolve({
          data: [] as Array<{ internal_project_id: string }>,
        }),
  ]);

  const allBlockers = (blockersRes.data ?? []) as unknown as BlockerDbRow[];
  const allTasks = (tasksRes.data ?? []) as unknown as TaskDbRow[];
  const allProjects =
    (projectsRes.data ?? []) as unknown as ProjectDbRow[];
  const allPeople = (peopleRes.data ?? []) as unknown as PersonDbRow[];
  const myTaskIdSet = new Set<string>(
    ((taskAssigneesRes.data ?? []) as Array<{ task_id: string }>).map(
      (r) => r.task_id,
    ),
  );
  const myProjectIdSet = new Set<string>(
    (
      (projectOwnersRes.data ?? []) as Array<{ internal_project_id: string }>
    ).map((r) => r.internal_project_id),
  );

  const taskById = new Map<string, TaskDbRow>();
  for (const t of allTasks) taskById.set(t.id, t);
  const projectNameById = new Map<string, string>();
  for (const p of allProjects) projectNameById.set(p.id, p.name);
  const personNameById = new Map<string, string>();
  for (const p of allPeople) personNameById.set(p.id, p.full_name);

  const now = new Date();

  const scopedBlockers = !isScopedToMe
    ? allBlockers
    : allBlockers.filter((b) => {
        // Blocker vinculado a task: mi persona debe estar asignada a esa task.
        if (b.task_id != null) return myTaskIdSet.has(b.task_id);
        // Blocker vinculado a project: mi persona debe ser owner del project.
        if (b.internal_project_id != null)
          return myProjectIdSet.has(b.internal_project_id);
        // Sin task ni project: no puede ser "mío" — se cae.
        return false;
      });

  const filtered = scopedBlockers.filter((b) => {
    if (statusFilter === "abiertos") return b.resolved_at == null;
    if (statusFilter === "resueltos") return b.resolved_at != null;
    return true;
  });

  const rows: BlockerRowData[] = filtered.map((b) => {
    const isTask = b.task_id != null;
    const task = isTask ? taskById.get(b.task_id!) ?? null : null;
    const parentProjectId = isTask
      ? task?.internal_project_id ?? null
      : b.internal_project_id;
    const parentProjectName = parentProjectId
      ? projectNameById.get(parentProjectId) ?? null
      : null;
    const parentLabel = isTask
      ? task?.title ?? "Tarea eliminada"
      : b.internal_project_id
        ? projectNameById.get(b.internal_project_id) ?? "Proyecto eliminado"
        : "—";

    const openedMs = new Date(b.opened_at).getTime();
    const daysOpen = Math.max(
      0,
      Math.floor((now.getTime() - openedMs) / 86_400_000),
    );

    return {
      id: b.id,
      parentKind: isTask ? "task" : "project",
      parentId: (isTask ? b.task_id : b.internal_project_id) ?? "",
      parentLabel,
      parentProjectId,
      parentProjectName,
      reason: b.reason,
      openedAt: b.opened_at,
      resolvedAt: b.resolved_at,
      resolvedById: b.resolved_by,
      resolvedByName: b.resolved_by
        ? personNameById.get(b.resolved_by) ?? null
        : null,
      daysOpen,
    };
  });

  // Options para el drawer.
  const taskOptions: TaskOptionForBlocker[] = allTasks
    // Solo tareas abiertas — bloquear una tarea 'listo' es raro.
    .filter((t) => t.status !== "listo")
    .map((t) => ({
      id: t.id,
      title: t.title,
      projectName: t.internal_project_id
        ? projectNameById.get(t.internal_project_id) ?? null
        : null,
    }));

  const projectOptions: ProjectOptionForBlocker[] = allProjects.map((p) => ({
    id: p.id,
    name: p.name,
  }));

  const peopleOptions: PersonOptionForBlocker[] = allPeople
    .filter((p) => p.active)
    .map((p) => ({ id: p.id, fullName: p.full_name }));

  // Stats sobre el subset del scope activo (no sobre los filtered — los
  // stats respetan el scope para que "abiertos" muestre "mis abiertos"
  // cuando estoy en scope=mine).
  const openBlockers = scopedBlockers.filter((b) => b.resolved_at == null);
  const oldOpenCount = openBlockers.filter((b) => {
    const openedMs = new Date(b.opened_at).getTime();
    const days = Math.floor((now.getTime() - openedMs) / 86_400_000);
    return days >= 7;
  }).length;

  function buildHref(overrides: {
    scope?: Scope;
    status?: StatusFilter;
  }): string {
    const nextScope = overrides.scope ?? scope;
    const nextStatus = overrides.status ?? statusFilter;
    const params = new URLSearchParams();
    // Default scope = "mine" — solo escribimos el query si difiere.
    if (nextScope !== "mine") params.set("scope", nextScope);
    if (nextStatus !== "abiertos") params.set("status", nextStatus);
    const qs = params.toString();
    return qs ? `/operaciones/bloqueadores?${qs}` : "/operaciones/bloqueadores";
  }

  const scopePills = (
    <KgParamPills
      ariaLabel="Alcance"
      options={[
        {
          label: "Míos",
          href: buildHref({ scope: "mine" }),
          active: isScopedToMe,
        },
        {
          label: "Todos",
          href: buildHref({ scope: "all" }),
          active: !isScopedToMe,
        },
      ]}
    />
  );

  if (showPersonMissing) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <ContextBar
          icon={<IconOps size={16} />}
          title="Mis bloqueadores"
          stats={[]}
        />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {scopePills}
        </div>
        <Panel title="Mis bloqueadores">
          <EmptyState
            title="Tu usuario no está vinculado a una persona"
            hint="Pedile al administrador que te vincule con tu persona en Configuración → Personas. Mientras tanto podés cambiar a 'Todos' para ver la vista global."
          />
        </Panel>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconOps size={16} />}
        title={isScopedToMe ? "Mis bloqueadores" : "Bloqueadores"}
        stats={[
          {
            l: isScopedToMe ? "Míos abiertos" : "Abiertos",
            v: fCount(openBlockers.length),
          },
          {
            l: "Viejos (7d+)",
            v: fCount(oldOpenCount),
            c: oldOpenCount > 0 ? "#F04060" : undefined,
          },
          {
            l: "Resueltos",
            v: fCount(scopedBlockers.length - openBlockers.length),
          },
        ]}
      />

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {scopePills}
        <KgParamPills
          ariaLabel="Filtrar por estado"
          options={STATUS_FILTER_OPTIONS.map((o) => ({
            label: o.label,
            href: buildHref({ status: o.value }),
            active: statusFilter === o.value,
          }))}
        />
      </div>

      <Panel title="Bloqueadores">
        <BlockersView
          rows={rows}
          totalCount={rows.length}
          tasks={taskOptions}
          projects={projectOptions}
          people={peopleOptions}
        />
      </Panel>
    </div>
  );
}

function parseStatus(v: string | string[] | undefined): StatusFilter {
  if (typeof v !== "string") return "abiertos";
  if (v === "resueltos" || v === "todos") return v;
  return "abiertos";
}
