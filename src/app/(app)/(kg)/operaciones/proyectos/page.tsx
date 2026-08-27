import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import { IconOps } from "@/components/kg/icons";
import { KgPageFilters } from "@/components/kg/page-menu";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { resolveCurrentPersonId } from "@/lib/ops/current-person";
import { fCount } from "@/lib/finance/format";
import { getOrgPeople } from "@/lib/finance/reference";
import { requireSessionProfile } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

import type { OwnerOption } from "./internal-project-form-drawer";
import {
  InternalProjectsView,
  type InternalProjectRowData,
} from "./internal-projects-view";
import { OwnerFilterSelect } from "./owner-filter-select";

export const metadata: Metadata = { title: "Proyectos internos · Operaciones" };

// ═══════════════════════════════════════════════════════════════════════════
// Lista de proyectos internos.
//
// Filtros por searchParams:
//   ?scope=mine|all                   default mine (TODOS los roles).
//                                     "mine" filtra a proyectos donde la
//                                     persona vinculada al user actual figura
//                                     en internal_project_owners. Toggle
//                                     "Mis proyectos / Todos" siempre visible.
//   ?status=activos|cerrados|todos    default activos
//                                      (activos = todo lo que no es 'listo';
//                                       cerrados = 'listo')
//   ?ownerId=<uuid>                   opcional — filtra a los proyectos donde
//                                     la persona figura en internal_project_owners.
//                                     Solo aplica cuando scope=all.
// ═══════════════════════════════════════════════════════════════════════════

type Status =
  | "sin_empezar"
  | "en_proceso"
  | "bloqueado"
  | "alerta_maxima"
  | "listo";
type Priority = "alta" | "media" | "baja";

type Scope = "mine" | "all";
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
  "sin_empezar",
  "en_proceso",
  "bloqueado",
  "alerta_maxima",
]);

interface ProjectDbRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: Status;
  readonly priority: Priority;
  readonly starts_on: string | null;
  readonly due_on: string | null;
  readonly closed_at: string | null;
  readonly notes: string | null;
  readonly notion_page_id: string | null;
  readonly notion_synced_at: string | null;
}

interface ProjectOwnerRow {
  readonly internal_project_id: string;
  readonly person_id: string;
}

interface PersonDbRow {
  readonly id: string;
  readonly full_name: string;
  readonly active: boolean;
}

interface TaskProgressRow {
  readonly internal_project_id: string | null;
  readonly status: Status;
}

export default async function ProyectosInternosPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp] = await Promise.all([requireSessionProfile(), searchParams]);
  const scope: Scope = sp.scope === "all" ? "all" : "mine";
  const isScopedToMe = scope === "mine";
  const statusFilter = parseStatus(sp.status);
  // ownerId manual solo aplica en scope=all — en "mine" la lista ya está
  // implícitamente scopeada a mi persona vía internal_project_owners.
  const ownerIdFilter = isScopedToMe ? null : parseUuidParam(sp.ownerId);

  const currentPersonId = isScopedToMe ? await resolveCurrentPersonId() : null;
  const showPersonMissing = isScopedToMe && currentPersonId == null;

  const supabase = await createClient();

  const [projectsRes, allPeopleRef, tasksRes, ownersRes] = await Promise.all([
    supabase
      .from("internal_projects")
      .select(
        "id, name, description, status, priority, starts_on, due_on, closed_at, notes, notion_page_id, notion_synced_at",
      )
      .order("status", { ascending: true })
      .order("due_on", { ascending: true, nullsFirst: false })
      .order("name", { ascending: true }),
    getOrgPeople(),
    // Progreso: solo necesitamos status + project id. Tareas huérfanas
    // (internal_project_id null) se descartan en el agregado.
    supabase
      .from("tasks")
      .select("internal_project_id, status")
      .not("internal_project_id", "is", null),
    // 0140: owners viven en junction. Traemos todas las filas y las
    // agrupamos client-side por project_id.
    supabase
      .from("internal_project_owners")
      .select("internal_project_id, person_id"),
  ]);

  const allProjects =
    (projectsRes.data ?? []) as unknown as ProjectDbRow[];
  const allPeople = allPeopleRef as unknown as PersonDbRow[];
  const allTasks = (tasksRes.data ?? []) as unknown as TaskProgressRow[];
  const allOwners = (ownersRes.data ?? []) as unknown as ProjectOwnerRow[];

  // Agrupar owners por project_id.
  const ownersByProject = new Map<string, string[]>();
  for (const o of allOwners) {
    const list = ownersByProject.get(o.internal_project_id) ?? [];
    list.push(o.person_id);
    ownersByProject.set(o.internal_project_id, list);
  }

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
    if (t.status === "listo") {
      tasksDoneByProject.set(
        t.internal_project_id,
        (tasksDoneByProject.get(t.internal_project_id) ?? 0) + 1,
      );
    } else if (OPEN_STATUSES.has(t.status)) {
      tasksOpenByProject.set(
        t.internal_project_id,
        (tasksOpenByProject.get(t.internal_project_id) ?? 0) + 1,
      );
    }
  }

  const filtered = allProjects.filter((p) => {
    if (statusFilter === "activos" && !OPEN_STATUSES.has(p.status)) return false;
    if (statusFilter === "cerrados" && OPEN_STATUSES.has(p.status)) return false;
    // Scope "mine": el proyecto tiene que tener a mi persona como owner. Si
    // no tengo persona vinculada (showPersonMissing), no llega acá — la UI
    // rebota al empty state antes de renderizar la lista.
    if (isScopedToMe && currentPersonId != null) {
      const projectOwners = ownersByProject.get(p.id) ?? [];
      if (!projectOwners.includes(currentPersonId)) return false;
    }
    // Filtro manual por owner — solo activo cuando scope=all.
    if (!isScopedToMe && ownerIdFilter != null) {
      const projectOwners = ownersByProject.get(p.id) ?? [];
      if (!projectOwners.includes(ownerIdFilter)) return false;
    }
    return true;
  });

  const rows: InternalProjectRowData[] = filtered.map((p) => {
    const total = tasksTotalByProject.get(p.id) ?? 0;
    const done = tasksDoneByProject.get(p.id) ?? 0;
    const open = tasksOpenByProject.get(p.id) ?? 0;
    const progressPct = total > 0 ? Math.round((done / total) * 100) : null;
    const ownerIds = ownersByProject.get(p.id) ?? [];
    const ownerNames = ownerIds
      .map((pid) => personNameById.get(pid))
      .filter((n): n is string => !!n);
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      status: p.status,
      priority: p.priority,
      ownerIds,
      ownerNames,
      startsOn: p.starts_on,
      dueOn: p.due_on,
      closedAt: p.closed_at,
      notes: p.notes,
      progressPct,
      openTasksCount: open,
      notionPageId: p.notion_page_id,
      notionSyncedAt: p.notion_synced_at,
    };
  });

  const totalCount = allProjects.length;
  const openCount = allProjects.filter((p) => OPEN_STATUSES.has(p.status))
    .length;
  const blockedCount = allProjects.filter((p) => p.status === "bloqueado").length;
  const notStartedCount = allProjects.filter(
    (p) => p.status === "sin_empezar",
  ).length;

  function buildHref(overrides: {
    scope?: Scope;
    status?: StatusFilter;
    ownerId?: string | null;
  }): string {
    const nextScope = overrides.scope ?? scope;
    const nextStatus = overrides.status ?? statusFilter;
    const nextOwnerId =
      overrides.ownerId !== undefined ? overrides.ownerId : ownerIdFilter;
    const params = new URLSearchParams();
    // Default scope = "mine" — solo escribimos el query si difiere.
    if (nextScope !== "mine") params.set("scope", nextScope);
    if (nextStatus !== "activos") params.set("status", nextStatus);
    // ownerId manual solo tiene sentido en scope=all.
    if (nextScope === "all" && nextOwnerId != null) {
      params.set("ownerId", nextOwnerId);
    }
    const qs = params.toString();
    return qs ? `/operaciones/proyectos?${qs}` : "/operaciones/proyectos";
  }

  const scopePills = (
    <KgParamPills
      ariaLabel="Alcance"
      options={[
        {
          label: "Mis proyectos",
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
      <div className="flex h-full min-h-0 flex-col gap-5">
        <ContextBar
          icon={<IconOps size={16} />}
          title="Mis proyectos"
          stats={[]}
        />
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          {scopePills}
        </div>
        <Panel title="Mis proyectos">
          <EmptyState
            title="Tu usuario no está vinculado a una persona"
            hint="Pedile al administrador que te vincule con tu persona en Configuración → Personas. Mientras tanto podés cambiar a 'Todos' para ver la vista global."
          />
        </Panel>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <ContextBar
        icon={<IconOps size={16} />}
        title={isScopedToMe ? "Mis proyectos" : "Proyectos internos"}
        stats={[
          { l: "Total", v: fCount(totalCount) },
          { l: isScopedToMe ? "Míos abiertos" : "Abiertos", v: fCount(openCount) },
          { l: "Bloqueados", v: fCount(blockedCount) },
          { l: "Sin empezar", v: fCount(notStartedCount) },
        ]}
      />

      <KgPageFilters
        activeCount={
          (statusFilter !== "activos" ? 1 : 0) +
          (ownerIdFilter != null ? 1 : 0)
        }
      >
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          {scopePills}
          <KgParamPills
            ariaLabel="Filtrar por estado"
            options={STATUS_FILTER_OPTIONS.map((o) => ({
              label: o.label,
              href: buildHref({ status: o.value }),
              active: statusFilter === o.value,
            }))}
          />
          {!isScopedToMe && (
            <OwnerFilterSelect
              people={owners}
              currentId={ownerIdFilter}
            />
          )}
        </div>
      </KgPageFilters>

      <InternalProjectsView
        rows={rows}
        totalCount={rows.length}
        owners={owners}
      />
    </div>
  );
}

function parseStatus(v: string | string[] | undefined): StatusFilter {
  if (typeof v !== "string") return "activos";
  if (v === "cerrados" || v === "todos") return v;
  return "activos";
}

function parseUuidParam(v: string | string[] | undefined): string | null {
  if (typeof v !== "string" || v.length === 0) return null;
  return v;
}
