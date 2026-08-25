import type { Metadata } from "next";
import Link from "next/link";

import { ContextBar, type ContextBarStat } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import { IconOps } from "@/components/kg/icons";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { StatusPill } from "@/components/kg/status-pill";
import {
  computeLoadByPerson,
  countUnassignedOpenTasks,
  sumMinutesByPerson,
} from "@/lib/ops/carga";
import { resolveCurrentPersonId } from "@/lib/ops/current-person";
import { filterOverdueTasks } from "@/lib/ops/overdue";
import { computeThroughput } from "@/lib/ops/throughput";
import type {
  OpsPersonRow,
  OpsTaskRow,
  OpsTimeEntryRow,
} from "@/lib/ops/types";
import { fCount } from "@/lib/finance/format";
import { requireSessionProfile } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Operaciones" };

// ═══════════════════════════════════════════════════════════════════════════
// Dashboard del módulo Operaciones.
//
// Consume selectores puros en src/lib/ops. Todo el cálculo vive ahí — la
// page solo fetchea, transforma a shapes de types.ts y pasa. Cero lógica
// nueva de negocio acá.
//
// Rango configurable (?range=mes|90d|365d) — default mes.
// ═══════════════════════════════════════════════════════════════════════════

type RangeFilter = "mes" | "90d" | "365d";

const RANGE_OPTIONS: ReadonlyArray<{
  value: RangeFilter;
  label: string;
  days: number;
}> = [
  { value: "mes", label: "Mes", days: 30 },
  { value: "90d", label: "90 días", days: 90 },
  { value: "365d", label: "1 año", days: 365 },
];

interface ProjectRow {
  readonly id: string;
  readonly status:
    | "sin_empezar"
    | "en_proceso"
    | "bloqueado"
    | "alerta_maxima"
    | "listo";
}

interface BlockerRow {
  readonly id: string;
  readonly reason: string;
  readonly opened_at: string;
  readonly resolved_at: string | null;
  readonly internal_project_id: string | null;
  readonly task_id: string | null;
}

const OPEN_PROJECT_STATUSES = new Set<ProjectRow["status"]>([
  "sin_empezar",
  "en_proceso",
  "bloqueado",
  "alerta_maxima",
]);

type Scope = "mine" | "all";

export default async function OperacionesDashboardPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp] = await Promise.all([requireSessionProfile(), searchParams]);
  const rangeFilter = parseRange(sp.range);
  const rangeDays =
    RANGE_OPTIONS.find((o) => o.value === rangeFilter)?.days ?? 30;

  const today = todayYmd();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - rangeDays);
  const cutoffYmd = ymdOf(cutoffDate);
  const cutoffIso = cutoffDate.toISOString();

  // Scope default = "mine" para TODOS los roles (incluidos super/dev). El
  // toggle "Mis operaciones / Todas" siempre está visible y cambia ?scope=all.
  // Si el user no tiene organization_people vinculada, "mine" cae en empty
  // state con instrucción de vincular — pero puede togglear a "all" y ver
  // igual todos los datos.
  const scope: Scope = sp.scope === "all" ? "all" : "mine";
  const isScopedToMe = scope === "mine";
  const currentPersonId = isScopedToMe ? await resolveCurrentPersonId() : null;
  const showPersonMissing = isScopedToMe && currentPersonId == null;

  const supabase = await createClient();

  // Cuando scopeamos a una persona, primero traemos los task_ids donde esa
  // persona figura en task_assignees, y filtramos la query de tasks por esos
  // ids. Sin persona (isScopedToMe=true + currentPersonId=null) forzamos 0.
  let scopedTaskIds: string[] | null = null;
  if (isScopedToMe) {
    if (currentPersonId == null) {
      scopedTaskIds = [];
    } else {
      const myRes = await supabase
        .from("task_assignees")
        .select("task_id")
        .eq("person_id", currentPersonId);
      scopedTaskIds = ((myRes.data ?? []) as Array<{ task_id: string }>).map(
        (r) => r.task_id,
      );
    }
  }

  const tasksBaseQuery = supabase
    .from("tasks")
    .select("id, status, priority, due_on, completed_at, created_at");
  const tasksQuery =
    scopedTaskIds != null
      ? scopedTaskIds.length === 0
        ? tasksBaseQuery.eq("id", "__no-match__")
        : tasksBaseQuery.in("id", scopedTaskIds)
      : tasksBaseQuery;

  const assigneesBaseQuery = supabase
    .from("task_assignees")
    .select("task_id, person_id");
  const assigneesQuery =
    scopedTaskIds != null
      ? scopedTaskIds.length === 0
        ? assigneesBaseQuery.eq("task_id", "__no-match__")
        : assigneesBaseQuery.in("task_id", scopedTaskIds)
      : assigneesBaseQuery;

  const entriesBaseQuery = supabase
    .from("time_entries")
    .select("person_id, minutes, logged_on")
    .gte("logged_on", cutoffYmd);
  const entriesQuery =
    isScopedToMe && currentPersonId != null
      ? entriesBaseQuery.eq("person_id", currentPersonId)
      : isScopedToMe
        ? entriesBaseQuery.eq("person_id", "__no-match__")
        : entriesBaseQuery;

  const peopleBaseQuery = supabase
    .from("organization_people")
    .select("id, full_name, active")
    .eq("active", true)
    .order("full_name", { ascending: true });
  const peopleQuery =
    isScopedToMe && currentPersonId != null
      ? peopleBaseQuery.eq("id", currentPersonId)
      : isScopedToMe
        ? peopleBaseQuery.eq("id", "__no-match__")
        : peopleBaseQuery;

  const [
    projectsRes,
    tasksRes,
    taskAssigneesRes,
    blockersRes,
    entriesRes,
    peopleRes,
  ] = await Promise.all([
    supabase.from("internal_projects").select("id, status"),
    tasksQuery,
    assigneesQuery,
    supabase
      .from("blockers")
      .select(
        "id, reason, opened_at, resolved_at, internal_project_id, task_id",
      )
      .is("resolved_at", null)
      .order("opened_at", { ascending: true }),
    entriesQuery,
    peopleQuery,
  ]);

  const projects = (projectsRes.data ?? []) as unknown as ProjectRow[];
  const rawTasks = (tasksRes.data ?? []) as unknown as Array<
    Omit<OpsTaskRow, "assignee_ids">
  >;
  const taskAssigneeRows = (taskAssigneesRes.data ?? []) as unknown as Array<{
    task_id: string;
    person_id: string;
  }>;
  const assigneesByTask = new Map<string, string[]>();
  for (const r of taskAssigneeRows) {
    const list = assigneesByTask.get(r.task_id) ?? [];
    list.push(r.person_id);
    assigneesByTask.set(r.task_id, list);
  }
  // Hidratar assignee_ids en cada task para que los selectores puros los vean.
  const tasks: OpsTaskRow[] = rawTasks.map((t) => ({
    ...t,
    assignee_ids: assigneesByTask.get(t.id) ?? [],
  }));
  const rawBlockers = (blockersRes.data ?? []) as unknown as BlockerRow[];
  // Cuando el scope es "mine", solo mostramos bloqueadores directamente
  // vinculados a mis tareas. Los que están linkeados a internal_project sin
  // task quedan fuera — no podemos saber si me tocan sin data de miembros de
  // proyecto (postergado hasta la sync con Notion).
  const myTaskIdSet = new Set(rawTasks.map((t) => t.id));
  const blockers = !isScopedToMe
    ? rawBlockers
    : rawBlockers.filter((b) => b.task_id != null && myTaskIdSet.has(b.task_id));
  const entries =
    (entriesRes.data ?? []) as unknown as OpsTimeEntryRow[];
  const people = (peopleRes.data ?? []) as unknown as OpsPersonRow[];

  // Selectores puros.
  const load = computeLoadByPerson({
    tasks,
    people,
    today,
    dueSoonWindowDays: 7,
  });
  const throughput = computeThroughput({
    tasks,
    from: cutoffIso,
    to: new Date().toISOString(),
  });
  const overdue = filterOverdueTasks(tasks, today);
  const unassignedOpen = countUnassignedOpenTasks(tasks);
  const minutesByPerson = sumMinutesByPerson(entries);

  // Agregados de header.
  const activeProjectsCount = projects.filter((p) =>
    OPEN_PROJECT_STATUSES.has(p.status),
  ).length;
  const openTasksCount = tasks.filter(
    (t) =>
      t.status === "sin_empezar" ||
      t.status === "en_proceso" ||
      t.status === "bloqueado" ||
      t.status === "alerta_maxima",
  ).length;
  const totalMinutesRange = Array.from(minutesByPerson.values()).reduce(
    (a, m) => a + m,
    0,
  );

  // Blockers viejos: abiertos 7d+.
  const nowMs = Date.now();
  const oldBlockers = blockers.filter((b) => {
    const openedMs = new Date(b.opened_at).getTime();
    return (nowMs - openedMs) / 86_400_000 >= 7;
  });

  // Ranking productividad por persona: ordena por horas dedicadas desc,
  // pero incluye a todos los activos (aunque tengan 0 horas).
  const productivityRows = load
    .map((l) => ({
      ...l,
      minutes: minutesByPerson.get(l.personId) ?? 0,
    }))
    .sort((a, b) => b.minutes - a.minutes);

  function buildHref(overrides: {
    range?: RangeFilter;
    scope?: Scope;
  }): string {
    const nextRange = overrides.range ?? rangeFilter;
    const nextScope = overrides.scope ?? scope;
    const params = new URLSearchParams();
    if (nextRange !== "mes") params.set("range", nextRange);
    // Default scope = "mine" — solo escribimos el query cuando difiere.
    if (nextScope !== "mine") params.set("scope", nextScope);
    const qs = params.toString();
    return qs ? `/operaciones?${qs}` : "/operaciones";
  }

  if (showPersonMissing) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <ContextBar
          icon={<IconOps size={16} />}
          title="Mis operaciones"
          stats={[]}
        />
        <KgParamPills
          ariaLabel="Alcance"
          options={[
            {
              label: "Mis operaciones",
              href: buildHref({ scope: "mine" }),
              active: true,
            },
            {
              label: "Todas",
              href: buildHref({ scope: "all" }),
              active: false,
            },
          ]}
        />
        <Panel title="Mis operaciones">
          <EmptyState
            title="Tu usuario no está vinculado a una persona"
            hint="Pedile al administrador que te vincule con tu persona en Configuración → Personas. Sin la vinculación no podemos mostrar tus tareas, horas ni bloqueadores. Mientras tanto podés cambiar a 'Todas' para ver la vista global."
          />
        </Panel>
      </div>
    );
  }

  const contextStats: ContextBarStat[] = [];
  if (isScopedToMe) contextStats.push({ l: "Alcance", v: "solo lo mío" });
  contextStats.push({ l: "Proyectos abiertos", v: fCount(activeProjectsCount) });
  contextStats.push({
    l: !isScopedToMe ? "Tareas abiertas" : "Mis tareas abiertas",
    v: fCount(openTasksCount),
  });
  contextStats.push({
    l: "Vencidas",
    v: fCount(overdue.length),
    c: overdue.length > 0 ? "#F04060" : undefined,
  });
  contextStats.push({
    l: "Blockers viejos (7d+)",
    v: fCount(oldBlockers.length),
    c: oldBlockers.length > 0 ? "#F04060" : undefined,
  });
  if (!isScopedToMe) {
    contextStats.push({
      l: "Sin asignar",
      v: fCount(unassignedOpen),
      c: unassignedOpen > 0 ? "#FFB800" : undefined,
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconOps size={16} />}
        title={!isScopedToMe ? "Operaciones" : "Mis operaciones"}
        stats={contextStats}
      />

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <KgParamPills
          ariaLabel="Alcance"
          options={[
            {
              label: "Mis operaciones",
              href: buildHref({ scope: "mine" }),
              active: isScopedToMe,
            },
            {
              label: "Todas",
              href: buildHref({ scope: "all" }),
              active: !isScopedToMe,
            },
          ]}
        />
        <KgParamPills
          ariaLabel="Rango temporal"
          options={RANGE_OPTIONS.map((o) => ({
            label: o.label,
            href: buildHref({ range: o.value }),
            active: rangeFilter === o.value,
          }))}
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 16,
        }}
      >
        <KpiCard
          label={`Throughput (${rangeDays}d)`}
          value={fCount(throughput.completed)}
          hint={`avg ${throughput.avgCycleDays == null ? "—" : throughput.avgCycleDays.toFixed(1)}d ciclo`}
        />
        <KpiCard
          label={`Horas registradas (${rangeDays}d)`}
          value={`${(totalMinutesRange / 60).toFixed(1)} h`}
          hint={
            !isScopedToMe
              ? `${people.length} personas activas`
              : "solo mis registros"
          }
        />
        <KpiCard
          label={!isScopedToMe ? "Bloqueadores abiertos" : "Mis bloqueadores"}
          value={fCount(blockers.length)}
          hint={
            oldBlockers.length > 0
              ? `${oldBlockers.length} con 7d+ sin resolver`
              : !isScopedToMe
                ? "ninguno crítico"
                : "ninguno en mis tareas"
          }
        />
        <KpiCard
          label={!isScopedToMe ? "Tareas vencidas" : "Mis tareas vencidas"}
          value={fCount(overdue.length)}
          hint={
            !isScopedToMe
              ? unassignedOpen > 0
                ? `${unassignedOpen} sin asignar en total`
                : "todo asignado"
              : overdue.length === 0
                ? "sin vencidas"
                : "revisá /operaciones/tareas"
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title={!isScopedToMe ? "Productividad por persona" : "Mi productividad"}>
          {productivityRows.length === 0 ? (
            <EmptyState
              title={!isScopedToMe ? "Sin personas activas" : "Sin actividad"}
              hint={
                !isScopedToMe
                  ? "Cargá personas en Organización → Personas para ver métricas por persona."
                  : "Todavía no tenés tareas ni horas registradas en el período."
              }
            />
          ) : (
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12,
              }}
            >
              <thead>
                <tr>
                  <th style={thStyle}>Persona</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Abiertas</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Vencidas</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Próx (7d)</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Horas</th>
                </tr>
              </thead>
              <tbody>
                {productivityRows.map((r) => (
                  <tr
                    key={r.personId}
                    style={{
                      borderTop: "1px solid var(--kg-border-subtle)",
                    }}
                  >
                    <td
                      style={{
                        ...tdStyle,
                        color: "var(--kg-text-1)",
                        fontWeight: 600,
                      }}
                    >
                      {r.personName}
                    </td>
                    <td style={{ ...tdStyle, ...numStyle }}>
                      {r.open === 0 ? (
                        <span style={{ color: "var(--kg-text-3)" }}>—</span>
                      ) : (
                        r.open
                      )}
                    </td>
                    <td style={{ ...tdStyle, ...numStyle }}>
                      {r.overdue === 0 ? (
                        <span style={{ color: "var(--kg-text-3)" }}>—</span>
                      ) : (
                        <span
                          style={{
                            color: "var(--kg-negative-500)",
                            fontWeight: 600,
                          }}
                        >
                          {r.overdue}
                        </span>
                      )}
                    </td>
                    <td style={{ ...tdStyle, ...numStyle }}>
                      {r.dueSoon === 0 ? (
                        <span style={{ color: "var(--kg-text-3)" }}>—</span>
                      ) : (
                        r.dueSoon
                      )}
                    </td>
                    <td style={{ ...tdStyle, ...numStyle }}>
                      {r.minutes === 0
                        ? <span style={{ color: "var(--kg-text-3)" }}>—</span>
                        : `${(r.minutes / 60).toFixed(1)} h`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title={!isScopedToMe ? "Bloqueadores críticos" : "Mis bloqueadores"}>
          {oldBlockers.length === 0 ? (
            <EmptyState
              title="Sin bloqueadores viejos"
              hint={
                blockers.length === 0
                  ? !isScopedToMe
                    ? "No hay bloqueadores abiertos."
                    : "Ninguno abierto vinculado a tus tareas."
                  : `${blockers.length} abiertos, todos con menos de 7 días.`
              }
            />
          ) : (
            <div
              style={{ display: "flex", flexDirection: "column", gap: 8 }}
            >
              {oldBlockers.slice(0, 8).map((b) => {
                const days = Math.floor(
                  (nowMs - new Date(b.opened_at).getTime()) / 86_400_000,
                );
                return (
                  <div
                    key={b.id}
                    style={{
                      padding: "10px 12px",
                      borderRadius: "var(--kg-r-8)",
                      background: "var(--kg-surface-2-solid)",
                      border: "1px solid var(--kg-border-subtle)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <div
                      style={{
                        color: "var(--kg-text-1)",
                        fontSize: 12,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={b.reason}
                    >
                      {b.reason}
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <StatusPill
                        text={`${days} días`}
                        tone={
                          days >= 14
                            ? "var(--kg-negative-500)"
                            : "var(--kg-warning-500)"
                        }
                      />
                    </div>
                  </div>
                );
              })}
              <Link
                href="/operaciones/bloqueadores"
                className="kg-focus"
                style={{
                  color: "var(--kg-accent-text)",
                  fontSize: 11,
                  fontWeight: 700,
                  textDecoration: "none",
                  padding: "6px 0",
                }}
              >
                Ver todos ({blockers.length} abiertos) →
              </Link>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
}: {
  readonly label: string;
  readonly value: string;
  readonly hint: string;
}) {
  return (
    <div
      className="kg-glass"
      style={{
        borderRadius: "var(--kg-r-16)",
        padding: "16px 18px",
        boxShadow: "var(--kg-shadow-amb)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        className="kg-t7"
        style={{
          color: "var(--kg-text-3)",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 0.3,
        }}
      >
        {label}
      </div>
      <div
        style={{
          color: "var(--kg-text-1)",
          fontSize: 26,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
        {hint}
      </div>
    </div>
  );
}

function parseRange(v: string | string[] | undefined): RangeFilter {
  if (typeof v !== "string") return "mes";
  if (v === "90d" || v === "365d") return v;
  return "mes";
}

function todayYmd(): string {
  return ymdOf(new Date());
}

function ymdOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const thStyle: React.CSSProperties = {
  padding: "8px 12px 8px 0",
  textAlign: "left",
  color: "var(--kg-text-3)",
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: 0.3,
  borderBottom: "1px solid var(--kg-border-subtle)",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 12px 10px 0",
  color: "var(--kg-text-2)",
  fontSize: 12,
};

const numStyle: React.CSSProperties = {
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};
