import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconCli } from "@/components/kg/icons";
import { KgPageFilters } from "@/components/kg/page-menu";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";
import { getOrgPeople } from "@/lib/finance/reference";
import type { TicketPriority, TicketStatus } from "@/lib/clients/types";
import { createClient } from "@/lib/supabase/server";

import type {
  ClientOptionForTicket,
  PersonOptionForTicket,
} from "./ticket-form-drawer";
import { TicketsView, type TicketRowData } from "./tickets-view";

export const metadata: Metadata = { title: "Tickets · Clientes" };

// ═══════════════════════════════════════════════════════════════════════════
// Vista global de tickets.
//
// Fetch:
//   - Tickets (todos los de la org via RLS).
//   - Clients activos + sus projects atados (para el drawer y filtro).
//   - Personas activas (para el assignee dropdown y el label).
//
// Filtros por searchParams:
//   ?status=abiertos|cerrados|todos   default abiertos
//   ?priority=urgente|alta|media|baja  opcional
//   ?clientId=<uuid>                   opcional
// ═══════════════════════════════════════════════════════════════════════════

type StatusFilter = "abiertos" | "cerrados" | "todos";

const STATUS_FILTER_OPTIONS: ReadonlyArray<{
  value: StatusFilter;
  label: string;
}> = [
  { value: "abiertos", label: "Abiertos" },
  { value: "cerrados", label: "Cerrados" },
  { value: "todos", label: "Todos" },
];

const PRIORITY_OPTIONS: ReadonlyArray<{
  value: TicketPriority | "todas";
  label: string;
}> = [
  { value: "todas", label: "Todas" },
  { value: "urgente", label: "Urgentes" },
  { value: "alta", label: "Alta" },
  { value: "media", label: "Media" },
  { value: "baja", label: "Baja" },
];

const OPEN_STATUSES: ReadonlySet<TicketStatus> = new Set([
  "abierto",
  "en_progreso",
  "esperando_cliente",
]);

interface TicketDbRow {
  readonly id: string;
  readonly client_id: string;
  readonly project_id: string | null;
  readonly assignee_person_id: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly status: TicketStatus;
  readonly priority: TicketPriority;
  readonly category: string | null;
  readonly due_date: string | null;
  readonly resolved_at: string | null;
  readonly created_at: string;
}

interface ClientDbRow {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
}

interface ProjectDbRow {
  readonly id: string;
  readonly name: string;
  readonly client_id: string | null;
}

interface PersonDbRow {
  readonly id: string;
  readonly full_name: string;
  readonly active: boolean;
}

export default async function TicketsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const statusFilter = parseStatus(sp.status);
  const priorityFilter = parsePriority(sp.priority);
  const clientIdFilter = parseClientId(sp.clientId);

  const supabase = await createClient();

  const [ticketsRes, clientsRes, projectsRes, allPeopleRef] = await Promise.all([
    supabase
      .from("tickets")
      .select(
        "id, client_id, project_id, assignee_person_id, title, description, status, priority, category, due_date, resolved_at, created_at",
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("clients")
      .select("id, name, active")
      .order("name", { ascending: true }),
    supabase
      .from("projects")
      .select("id, name, client_id")
      .not("client_id", "is", null),
    getOrgPeople(),
  ]);

  const allTickets = (ticketsRes.data ?? []) as unknown as TicketDbRow[];
  const allClients = (clientsRes.data ?? []) as unknown as ClientDbRow[];
  const attachedProjects =
    (projectsRes.data ?? []) as unknown as ProjectDbRow[];
  const allPeople = allPeopleRef as unknown as PersonDbRow[];

  const activeClients = allClients.filter((c) => c.active);
  const activePeople = allPeople.filter((p) => p.active);

  // Mapa client_id → nombre (para labels de rows).
  const clientNameById = new Map<string, string>();
  for (const c of allClients) clientNameById.set(c.id, c.name);

  // Mapa project_id → nombre.
  const projectNameById = new Map<string, string>();
  for (const p of attachedProjects) projectNameById.set(p.id, p.name);

  // Mapa person_id → full_name (incluye inactivos para no mostrar "?" en
  // tickets asignados a alguien que se dio de baja).
  const personNameById = new Map<string, string>();
  for (const p of allPeople) personNameById.set(p.id, p.full_name);

  // Projects agrupados por cliente para el drawer.
  const projectsByClient = new Map<
    string,
    { id: string; name: string }[]
  >();
  for (const p of attachedProjects) {
    if (!p.client_id) continue;
    const arr = projectsByClient.get(p.client_id) ?? [];
    arr.push({ id: p.id, name: p.name });
    projectsByClient.set(p.client_id, arr);
  }

  const clientOptions: ClientOptionForTicket[] = activeClients.map((c) => ({
    id: c.id,
    name: c.name,
    projects: projectsByClient.get(c.id) ?? [],
  }));

  const peopleOptions: PersonOptionForTicket[] = activePeople.map((p) => ({
    id: p.id,
    fullName: p.full_name,
  }));

  // Filtrado en TS. Los volúmenes iniciales son bajos; si crece se pasa
  // a filtros SQL con paginación.
  const today = todayYmd();
  const filtered = allTickets.filter((t) => {
    if (statusFilter === "abiertos" && !OPEN_STATUSES.has(t.status))
      return false;
    if (statusFilter === "cerrados" && OPEN_STATUSES.has(t.status))
      return false;
    if (priorityFilter !== null && t.priority !== priorityFilter) return false;
    if (clientIdFilter != null && t.client_id !== clientIdFilter) return false;
    return true;
  });

  const rows: TicketRowData[] = filtered.map((t) => ({
    id: t.id,
    clientId: t.client_id,
    clientName: clientNameById.get(t.client_id) ?? "—",
    projectId: t.project_id,
    projectName: t.project_id
      ? projectNameById.get(t.project_id) ?? null
      : null,
    assigneePersonId: t.assignee_person_id,
    assigneeName: t.assignee_person_id
      ? personNameById.get(t.assignee_person_id) ?? null
      : null,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    category: t.category,
    dueDate: t.due_date,
    resolvedAt: t.resolved_at,
    createdAt: t.created_at,
  }));

  // Stats de header: sobre TODOS los tickets (no filtrados), para que los
  // números no bailen con los pills.
  const openTickets = allTickets.filter((t) => OPEN_STATUSES.has(t.status));
  const urgentOpen = openTickets.filter((t) => t.priority === "urgente").length;
  const overdue = openTickets.filter(
    (t) => t.due_date != null && t.due_date < today,
  ).length;

  function buildHref(overrides: {
    status?: StatusFilter;
    priority?: TicketPriority | "todas";
    clientId?: string | null;
  }): string {
    const nextStatus = overrides.status ?? statusFilter;
    const nextPriority =
      overrides.priority ??
      (priorityFilter ?? ("todas" as TicketPriority | "todas"));
    const nextClientId =
      overrides.clientId !== undefined ? overrides.clientId : clientIdFilter;
    const params = new URLSearchParams();
    if (nextStatus !== "abiertos") params.set("status", nextStatus);
    if (nextPriority !== "todas") params.set("priority", nextPriority);
    if (nextClientId != null) params.set("clientId", nextClientId);
    const qs = params.toString();
    return qs ? `/clientes/tickets?${qs}` : "/clientes/tickets";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconCli size={16} />}
        title="Tickets"
        stats={[
          { l: "Abiertos", v: fCount(openTickets.length) },
          {
            l: "Urgentes",
            v: fCount(urgentOpen),
            c: urgentOpen > 0 ? "#F04060" : undefined,
          },
          {
            l: "Vencidos",
            v: fCount(overdue),
            c: overdue > 0 ? "#FFB800" : undefined,
          },
        ]}
      />

      <KgPageFilters
        activeCount={
          (statusFilter !== "abiertos" ? 1 : 0) +
          (priorityFilter != null ? 1 : 0) +
          (clientIdFilter != null ? 1 : 0)
        }
      >
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
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
              active:
                (priorityFilter ?? "todas") === o.value,
            }))}
          />
          {clientIdFilter && (
            <a
              href={buildHref({ clientId: null })}
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
              Cliente: {clientNameById.get(clientIdFilter) ?? "—"} ✕
            </a>
          )}
        </div>
      </KgPageFilters>

      <Panel title="Tickets">
        <TicketsView
          rows={rows}
          totalCount={rows.length}
          clients={clientOptions}
          people={peopleOptions}
          presetClientId={clientIdFilter}
        />
      </Panel>
    </div>
  );
}

function parseStatus(v: string | string[] | undefined): StatusFilter {
  if (typeof v !== "string") return "abiertos";
  if (v === "cerrados" || v === "todos") return v;
  return "abiertos";
}

function parsePriority(
  v: string | string[] | undefined,
): TicketPriority | null {
  if (typeof v !== "string") return null;
  const allowed: TicketPriority[] = ["baja", "media", "alta", "urgente"];
  return (allowed as string[]).includes(v) ? (v as TicketPriority) : null;
}

function parseClientId(v: string | string[] | undefined): string | null {
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
