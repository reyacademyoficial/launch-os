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
  PersonOptionForTimeEntry,
  ProjectOptionForTimeEntry,
  TaskOptionForTimeEntry,
} from "./time-entry-form-drawer";
import {
  TimeEntriesView,
  type TimeEntryRowData,
} from "./time-entries-view";

export const metadata: Metadata = { title: "Tiempo · Operaciones" };

// ═══════════════════════════════════════════════════════════════════════════
// Lista global de registros de tiempo.
//
// Mismo patrón de scope que /operaciones/tareas:
//   - superadmin/dev → default "todos", toggle "mis registros".
//   - resto → default "mis registros", sin toggle.
//
// Filtros:
//   ?range=mes|semana|hoy|90d|todo    default mes
//   ?personId=<uuid>                   opcional (solo válido si scope=all)
//   ?projectId=<uuid>                  opcional
// ═══════════════════════════════════════════════════════════════════════════

type Scope = "mine" | "all";
type RangeFilter = "hoy" | "semana" | "mes" | "90d" | "todo";

const CAN_SEE_ALL_ROLES: ReadonlySet<Role> = new Set(["superadmin", "dev"]);

const RANGE_OPTIONS: ReadonlyArray<{ value: RangeFilter; label: string }> = [
  { value: "hoy", label: "Hoy" },
  { value: "semana", label: "Semana" },
  { value: "mes", label: "Mes" },
  { value: "90d", label: "90 días" },
  { value: "todo", label: "Todo" },
];

interface TimeEntryDbRow {
  readonly id: string;
  readonly person_id: string;
  readonly minutes: number;
  readonly logged_on: string;
  readonly task_id: string | null;
  readonly internal_project_id: string | null;
  readonly notes: string | null;
}

interface PersonDbRow {
  readonly id: string;
  readonly full_name: string;
  readonly active: boolean;
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
  readonly status: OpStatus;
}

interface ProjectDbRow {
  readonly id: string;
  readonly name: string;
  readonly status: OpStatus;
}

export default async function TiempoPage({
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
  const rangeFilter = parseRange(sp.range);
  const personIdFilter =
    scope === "all" ? parseUuidParam(sp.personId) : null;
  const projectIdFilter = parseUuidParam(sp.projectId);

  const currentPersonId =
    scope === "mine" ? await resolveCurrentPersonId() : null;
  const showPersonMissing = scope === "mine" && currentPersonId == null;

  const supabase = await createClient();

  const cutoff = rangeCutoffYmd(rangeFilter);

  // Server-scoped: si mine, filtramos por person_id acá. Si all, opcional
  // por personIdFilter.
  let entriesQuery = supabase
    .from("time_entries")
    .select(
      "id, person_id, minutes, logged_on, task_id, internal_project_id, notes",
    )
    .order("logged_on", { ascending: false });

  if (scope === "mine" && currentPersonId != null) {
    entriesQuery = entriesQuery.eq("person_id", currentPersonId);
  } else if (scope === "mine") {
    // Sin persona vinculada → 0 rows.
    entriesQuery = entriesQuery.eq("person_id", "__no-match__");
  } else if (personIdFilter != null) {
    entriesQuery = entriesQuery.eq("person_id", personIdFilter);
  }
  if (cutoff != null) {
    entriesQuery = entriesQuery.gte("logged_on", cutoff);
  }
  if (projectIdFilter != null) {
    entriesQuery = entriesQuery.eq("internal_project_id", projectIdFilter);
  }

  const [entriesRes, peopleRes, tasksRes, projectsRes] = await Promise.all([
    entriesQuery,
    supabase
      .from("organization_people")
      .select("id, full_name, active")
      .order("full_name", { ascending: true }),
    supabase
      .from("tasks")
      .select("id, title, status")
      .neq("status", "listo")
      .order("title", { ascending: true }),
    supabase
      .from("internal_projects")
      .select("id, name, status")
      .neq("status", "listo")
      .order("name", { ascending: true }),
  ]);

  const allEntries =
    (entriesRes.data ?? []) as unknown as TimeEntryDbRow[];
  const allPeople = (peopleRes.data ?? []) as unknown as PersonDbRow[];
  const allTasks = (tasksRes.data ?? []) as unknown as TaskDbRow[];
  const allProjects =
    (projectsRes.data ?? []) as unknown as ProjectDbRow[];

  const personById = new Map<string, PersonDbRow>();
  for (const p of allPeople) personById.set(p.id, p);
  const taskNameById = new Map<string, string>();
  for (const t of allTasks) taskNameById.set(t.id, t.title);
  const projectNameById = new Map<string, string>();
  for (const p of allProjects) projectNameById.set(p.id, p.name);

  const rows: TimeEntryRowData[] = allEntries.map((e) => ({
    id: e.id,
    personId: e.person_id,
    personName: personById.get(e.person_id)?.full_name ?? "—",
    minutes: e.minutes,
    loggedOn: e.logged_on,
    taskId: e.task_id,
    taskTitle: e.task_id ? taskNameById.get(e.task_id) ?? null : null,
    internalProjectId: e.internal_project_id,
    internalProjectName: e.internal_project_id
      ? projectNameById.get(e.internal_project_id) ?? null
      : null,
    notes: e.notes,
  }));

  const peopleOptions: PersonOptionForTimeEntry[] = allPeople.map((p) => ({
    id: p.id,
    fullName: p.full_name,
    active: p.active,
  }));

  const taskOptions: TaskOptionForTimeEntry[] = allTasks.map((t) => ({
    id: t.id,
    title: t.title,
  }));

  const projectOptions: ProjectOptionForTimeEntry[] = allProjects.map((p) => ({
    id: p.id,
    name: p.name,
  }));

  const totalMinutes = allEntries.reduce((acc, e) => acc + e.minutes, 0);
  const uniquePeople = new Set(allEntries.map((e) => e.person_id)).size;

  function buildHref(overrides: {
    scope?: Scope;
    range?: RangeFilter;
    personId?: string | null;
    projectId?: string | null;
  }): string {
    const nextScope = overrides.scope ?? scope;
    const nextRange = overrides.range ?? rangeFilter;
    const nextPersonId =
      overrides.personId !== undefined ? overrides.personId : personIdFilter;
    const nextProjectId =
      overrides.projectId !== undefined
        ? overrides.projectId
        : projectIdFilter;
    const defaultScope: Scope = canSeeAll ? "all" : "mine";
    const params = new URLSearchParams();
    if (nextScope !== defaultScope) params.set("scope", nextScope);
    if (nextRange !== "mes") params.set("range", nextRange);
    if (nextScope === "all" && nextPersonId != null) {
      params.set("personId", nextPersonId);
    }
    if (nextProjectId != null) params.set("projectId", nextProjectId);
    const qs = params.toString();
    return qs ? `/operaciones/tiempo?${qs}` : "/operaciones/tiempo";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconOps size={16} />}
        title={
          scope === "mine"
            ? `Mi tiempo${session.fullName ? ` · ${session.fullName}` : ""}`
            : "Tiempo · todos"
        }
        stats={[
          { l: "Registros", v: fCount(allEntries.length) },
          { l: "Horas", v: `${(totalMinutes / 60).toFixed(1)} h` },
          { l: "Personas", v: fCount(uniquePeople) },
        ]}
      />

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {canSeeAll && (
          <KgParamPills
            ariaLabel="Alcance"
            options={[
              {
                label: "Todos",
                href: buildHref({ scope: "all" }),
                active: scope === "all",
              },
              {
                label: "Mi tiempo",
                href: buildHref({ scope: "mine" }),
                active: scope === "mine",
              },
            ]}
          />
        )}
        <KgParamPills
          ariaLabel="Rango"
          options={RANGE_OPTIONS.map((o) => ({
            label: o.label,
            href: buildHref({ range: o.value }),
            active: rangeFilter === o.value,
          }))}
        />
        {personIdFilter && (
          <a
            href={buildHref({ personId: null })}
            className="kg-focus"
            style={chipStyle}
          >
            Persona: {personById.get(personIdFilter)?.full_name ?? "—"} ✕
          </a>
        )}
        {projectIdFilter && (
          <a
            href={buildHref({ projectId: null })}
            className="kg-focus"
            style={chipStyle}
          >
            Proyecto: {projectNameById.get(projectIdFilter) ?? "—"} ✕
          </a>
        )}
      </div>

      <Panel title={scope === "mine" ? "Mi tiempo" : "Tiempo del equipo"}>
        {showPersonMissing ? (
          <EmptyState
            title="Tu usuario no está vinculado a una persona"
            hint="Pedile al administrador que te vincule con tu persona en Organización → Personas para poder cargar tu tiempo."
            actions={
              <Link
                href="/organizacion/personas"
                className="kg-focus"
                style={ctaLinkStyle}
              >
                Ir a Personas
              </Link>
            }
          />
        ) : (
          <TimeEntriesView
            rows={rows}
            totalCount={rows.length}
            people={peopleOptions}
            tasks={taskOptions}
            projects={projectOptions}
            presetPersonId={scope === "mine" ? currentPersonId : null}
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
  return "all";
}

function parseRange(v: string | string[] | undefined): RangeFilter {
  if (typeof v !== "string") return "mes";
  if (v === "hoy" || v === "semana" || v === "90d" || v === "todo") return v;
  return "mes";
}

function parseUuidParam(v: string | string[] | undefined): string | null {
  if (typeof v !== "string" || v.length === 0) return null;
  return v;
}

function rangeCutoffYmd(range: RangeFilter): string | null {
  if (range === "todo") return null;
  const d = new Date();
  switch (range) {
    case "hoy":
      break;
    case "semana":
      d.setDate(d.getDate() - 7);
      break;
    case "mes":
      d.setDate(d.getDate() - 30);
      break;
    case "90d":
      d.setDate(d.getDate() - 90);
      break;
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const chipStyle: React.CSSProperties = {
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
};

const ctaLinkStyle: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 999,
  background: "var(--kg-accent-500)",
  border: "none",
  color: "#fff",
  fontSize: 12,
  fontWeight: 700,
  textDecoration: "none",
};
