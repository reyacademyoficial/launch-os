import type { Metadata } from "next";
import Link from "next/link";

import { ContextBar } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import { IconOps } from "@/components/kg/icons";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { resolveCurrentPersonId } from "@/lib/ops/current-person";
import { fCount } from "@/lib/finance/format";
import { requireSessionProfile, type Role } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

import type {
  AssigneeOptionForTask,
  ProjectOptionForTask,
} from "./task-form-drawer";
import { TasksView, type TaskRowData } from "./tasks-view";

export const metadata: Metadata = { title: "Tareas · Operaciones" };

// ═══════════════════════════════════════════════════════════════════════════
// Lista global de tareas.
//
// SCOPE (§2.0 del plan):
//   - superadmin / dev  → default "todas", toggle "mis tareas" disponible.
//   - resto (operador/coordinador/admin) → default "mis tareas", toggle NO
//     visible. Si fuerza ?scope=all por URL, se ignora silenciosamente.
//
// Filtros extras:
//   ?status=abiertas|cerradas|todas   default abiertas
//   ?priority=urgent|high|med|low     opcional
//   ?projectId=<uuid>                 opcional
//
// Marcado de vencidas: precomputado server-side (isOverdue = due_on <
// today AND status abierta). El view lo pinta como dot rojo + badge.
// ═══════════════════════════════════════════════════════════════════════════

type Status = "todo" | "doing" | "blocked" | "done" | "cancelled";
type Priority = "low" | "med" | "high" | "urgent";
type Scope = "mine" | "all";
type StatusFilter = "abiertas" | "cerradas" | "todas";

const OPEN_STATUSES: ReadonlySet<Status> = new Set([
  "todo",
  "doing",
  "blocked",
]);

const CAN_SEE_ALL_ROLES: ReadonlySet<Role> = new Set(["superadmin", "dev"]);

const STATUS_FILTER_OPTIONS: ReadonlyArray<{
  value: StatusFilter;
  label: string;
}> = [
  { value: "abiertas", label: "Abiertas" },
  { value: "cerradas", label: "Cerradas" },
  { value: "todas", label: "Todas" },
];

const PRIORITY_OPTIONS: ReadonlyArray<{
  value: Priority | "todas";
  label: string;
}> = [
  { value: "todas", label: "Todas" },
  { value: "urgent", label: "Urgentes" },
  { value: "high", label: "Alta" },
  { value: "med", label: "Media" },
  { value: "low", label: "Baja" },
];

interface TaskDbRow {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: Status;
  readonly priority: Priority;
  readonly internal_project_id: string | null;
  readonly assignee_id: string | null;
  readonly due_on: string | null;
  readonly completed_at: string | null;
  readonly created_at: string;
}

interface ProjectDbRow {
  readonly id: string;
  readonly name: string;
  readonly status: "backlog" | "active" | "paused" | "done" | "archived";
}

interface PersonDbRow {
  readonly id: string;
  readonly full_name: string;
  readonly active: boolean;
}

export default async function TareasPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [session, sp] = await Promise.all([
    requireSessionProfile(),
    searchParams,
  ]);

  const canSeeAll = CAN_SEE_ALL_ROLES.has(session.role);
  const scope: Scope = resolveScope(sp.scope, canSeeAll);
  const statusFilter = parseStatus(sp.status);
  const priorityFilter = parsePriority(sp.priority);
  const projectIdFilter = parseUuidParam(sp.projectId);

  const currentPersonId = scope === "mine" ? await resolveCurrentPersonId() : null;
  const showPersonMissing = scope === "mine" && currentPersonId == null;

  const supabase = await createClient();

  // Tasks: si scope=mine, filtramos server-side por assignee_id. Si es
  // "mine" pero el user no tiene persona vinculada, showPersonMissing=true
  // y devolvemos vacío.
  const tasksQuery = supabase
    .from("tasks")
    .select(
      "id, title, description, status, priority, internal_project_id, assignee_id, due_on, completed_at, created_at",
    )
    .order("due_on", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  const scopedTasksQuery =
    scope === "mine" && currentPersonId != null
      ? tasksQuery.eq("assignee_id", currentPersonId)
      : scope === "mine"
        ? tasksQuery.eq("assignee_id", "__no-match__") // devuelve 0 rows
        : tasksQuery;

  const [tasksRes, projectsRes, peopleRes] = await Promise.all([
    scopedTasksQuery,
    supabase
      .from("internal_projects")
      .select("id, name, status")
      .neq("status", "archived")
      .order("name", { ascending: true }),
    supabase
      .from("organization_people")
      .select("id, full_name, active")
      .order("full_name", { ascending: true }),
  ]);

  const allTasks = (tasksRes.data ?? []) as unknown as TaskDbRow[];
  const allProjects = (projectsRes.data ?? []) as unknown as ProjectDbRow[];
  const allPeople = (peopleRes.data ?? []) as unknown as PersonDbRow[];

  const projectNameById = new Map<string, string>();
  for (const p of allProjects) projectNameById.set(p.id, p.name);

  // Personas incluye inactivas para preservar nombres en tareas asignadas
  // a alguien que se dio de baja.
  const personNameById = new Map<string, string>();
  for (const p of allPeople) personNameById.set(p.id, p.full_name);

  const projectOptions: ProjectOptionForTask[] = allProjects.map((p) => ({
    id: p.id,
    name: p.name,
  }));
  const assigneeOptions: AssigneeOptionForTask[] = allPeople
    .filter((p) => p.active)
    .map((p) => ({ id: p.id, fullName: p.full_name }));

  const today = todayYmd();

  const filtered = allTasks.filter((t) => {
    if (statusFilter === "abiertas" && !OPEN_STATUSES.has(t.status))
      return false;
    if (statusFilter === "cerradas" && OPEN_STATUSES.has(t.status))
      return false;
    if (priorityFilter !== null && t.priority !== priorityFilter) return false;
    if (projectIdFilter != null && t.internal_project_id !== projectIdFilter)
      return false;
    return true;
  });

  const rows: TaskRowData[] = filtered.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    internalProjectId: t.internal_project_id,
    internalProjectName: t.internal_project_id
      ? projectNameById.get(t.internal_project_id) ?? null
      : null,
    assigneeId: t.assignee_id,
    assigneeName: t.assignee_id
      ? personNameById.get(t.assignee_id) ?? null
      : null,
    dueOn: t.due_on,
    completedAt: t.completed_at,
    createdAt: t.created_at,
    isOverdue:
      t.due_on != null && t.due_on < today && OPEN_STATUSES.has(t.status),
  }));

  // Stats sobre TODAS las tareas del scope activo (no filtradas por pills).
  const openTasks = allTasks.filter((t) => OPEN_STATUSES.has(t.status));
  const overdueCount = openTasks.filter(
    (t) => t.due_on != null && t.due_on < today,
  ).length;
  const urgentOpenCount = openTasks.filter(
    (t) => t.priority === "urgent",
  ).length;

  function buildHref(overrides: {
    scope?: Scope;
    status?: StatusFilter;
    priority?: Priority | "todas";
    projectId?: string | null;
  }): string {
    const nextScope = overrides.scope ?? scope;
    const nextStatus = overrides.status ?? statusFilter;
    const nextPriority =
      overrides.priority ??
      (priorityFilter ?? ("todas" as Priority | "todas"));
    const nextProjectId =
      overrides.projectId !== undefined
        ? overrides.projectId
        : projectIdFilter;
    const params = new URLSearchParams();
    // Default scope depende del rol — solo escribimos el query si difiere
    // del default para dejar URLs limpias.
    const defaultScope: Scope = canSeeAll ? "all" : "mine";
    if (nextScope !== defaultScope) params.set("scope", nextScope);
    if (nextStatus !== "abiertas") params.set("status", nextStatus);
    if (nextPriority !== "todas") params.set("priority", nextPriority);
    if (nextProjectId != null) params.set("projectId", nextProjectId);
    const qs = params.toString();
    return qs ? `/operaciones/tareas?${qs}` : "/operaciones/tareas";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconOps size={16} />}
        title={
          scope === "mine"
            ? `Mis tareas${session.fullName ? ` · ${session.fullName}` : ""}`
            : "Tareas · todas"
        }
        stats={[
          { l: "Abiertas", v: fCount(openTasks.length) },
          {
            l: "Urgentes",
            v: fCount(urgentOpenCount),
            c: urgentOpenCount > 0 ? "#F04060" : undefined,
          },
          {
            l: "Vencidas",
            v: fCount(overdueCount),
            c: overdueCount > 0 ? "#F04060" : undefined,
          },
        ]}
      />

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {canSeeAll && (
          <KgParamPills
            ariaLabel="Alcance"
            options={[
              {
                label: "Todas",
                href: buildHref({ scope: "all" }),
                active: scope === "all",
              },
              {
                label: "Mis tareas",
                href: buildHref({ scope: "mine" }),
                active: scope === "mine",
              },
            ]}
          />
        )}
        <KgParamPills
          ariaLabel="Filtrar por estado"
          options={STATUS_FILTER_OPTIONS.map((o) => ({
            label: o.label,
            href: buildHref({ status: o.value }),
            active: statusFilter === o.value,
          }))}
        />
        <KgParamPills
          ariaLabel="Filtrar por prioridad"
          options={PRIORITY_OPTIONS.map((o) => ({
            label: o.label,
            href: buildHref({ priority: o.value }),
            active: (priorityFilter ?? "todas") === o.value,
          }))}
        />
        {projectIdFilter && (
          <a
            href={buildHref({ projectId: null })}
            className="kg-focus"
            style={{
              padding: "6px 12px",
              borderRadius: 999,
              background: "transparent",
              border: "1px solid var(--kg-border-subtle)",
              color: "var(--kg-text-2)",
              fontSize: 11,
              fontWeight: 700,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            Proyecto: {projectNameById.get(projectIdFilter) ?? "—"} ✕
          </a>
        )}
      </div>

      <Panel title={scope === "mine" ? "Mis tareas" : "Tareas"}>
        {showPersonMissing ? (
          <EmptyState
            title="Tu usuario no está vinculado a una persona"
            hint="Pedile al administrador que te vincule con tu persona en Organización → Personas. Sin la vinculación no podemos mostrar tus tareas asignadas."
            actions={
              <Link
                href="/organizacion/personas"
                className="kg-focus"
                style={{
                  padding: "8px 16px",
                  borderRadius: 999,
                  background: "var(--kg-accent-500)",
                  border: "none",
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 700,
                  textDecoration: "none",
                }}
              >
                Ir a Personas
              </Link>
            }
          />
        ) : (
          <TasksView
            rows={rows}
            totalCount={rows.length}
            projects={projectOptions}
            assignees={assigneeOptions}
            presetProjectId={projectIdFilter}
            presetAssigneeId={scope === "mine" ? currentPersonId : null}
            canCreate
          />
        )}
      </Panel>
    </div>
  );
}

function resolveScope(
  v: string | string[] | undefined,
  canSeeAll: boolean,
): Scope {
  const raw = typeof v === "string" ? v : null;
  if (!canSeeAll) return "mine";
  if (raw === "mine") return "mine";
  // Default para superadmin/dev = "all". Cualquier otro valor cae a all.
  return "all";
}

function parseStatus(v: string | string[] | undefined): StatusFilter {
  if (typeof v !== "string") return "abiertas";
  if (v === "cerradas" || v === "todas") return v;
  return "abiertas";
}

function parsePriority(
  v: string | string[] | undefined,
): Priority | null {
  if (typeof v !== "string") return null;
  const allowed: Priority[] = ["low", "med", "high", "urgent"];
  return (allowed as string[]).includes(v) ? (v as Priority) : null;
}

function parseUuidParam(v: string | string[] | undefined): string | null {
  if (typeof v !== "string" || v.length === 0) return null;
  return v;
}

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
