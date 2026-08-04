import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconCli } from "@/components/kg/icons";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { computeHealthScore } from "@/lib/clients/health";
import type {
  NpsResponseRow,
  RelationshipStatus,
  TicketRow,
} from "@/lib/clients/types";
import { fCount } from "@/lib/finance/format";
import { createClient } from "@/lib/supabase/server";

import { ClientesView, type ClientRowData } from "./clientes-view";

export const metadata: Metadata = { title: "Clientes" };

// ═══════════════════════════════════════════════════════════════════════════
// Dashboard del módulo Clientes.
//
// Trae TODAS las filas de clients + los projects atados (para el contador
// por cliente). Sin paginación por ahora — con ~decenas de clientes es un
// non-issue; si crece, se agrega paginación con searchParams igual que
// gastos/nomina.
//
// Filtro por estado vía ?show=active|inactive|all (default active). Sigue
// el patrón de organizacion/personas.
//
// TODO al construir dashboard real: agregar KPIs de health/LTV/churn en
// ContextBar y una tabla superior con los últimos movimientos. Hoy los
// stats son conteos simples.
// ═══════════════════════════════════════════════════════════════════════════

type ShowFilter = "active" | "inactive" | "all";

const SHOW_OPTIONS: ReadonlyArray<{ value: ShowFilter; label: string }> = [
  { value: "active", label: "Activos" },
  { value: "inactive", label: "Archivados" },
  { value: "all", label: "Todos" },
];

interface ClientDbRow {
  readonly id: string;
  readonly name: string;
  readonly business_name: string | null;
  readonly industry: string | null;
  readonly notes: string | null;
  readonly active: boolean;
}

interface ProjectClientLink {
  readonly client_id: string | null;
}

interface HealthLink {
  readonly client_id: string;
  readonly relationship_status: RelationshipStatus;
  readonly health_score: number | null;
  readonly last_contact_at: string | null;
}

type NpsRowFromDb = NpsResponseRow;

type TicketRowFromDb = TicketRow;

export default async function ClientesDashboardPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const show = parseShow(sp.show);

  const supabase = await createClient();

  const [clientsRes, projectsRes, healthRes, npsRes, ticketsRes] =
    await Promise.all([
      supabase
        .from("clients")
        .select("id, name, business_name, industry, notes, active")
        .order("active", { ascending: false })
        .order("name", { ascending: true }),
      supabase
        .from("projects")
        .select("client_id")
        .not("client_id", "is", null),
      supabase
        .from("project_health")
        .select(
          "client_id, relationship_status, health_score, last_contact_at",
        ),
      // Inputs para el score compuesto por cliente. Traemos todo org-scope
      // (RLS filtra) y agrupamos en TS. En volúmenes iniciales es un fetch
      // pequeño; si el módulo crece, se puede paginar o mover a un RPC
      // que agregue por cliente.
      supabase
        .from("nps_responses")
        .select("client_id, score, responded_at"),
      supabase
        .from("tickets")
        .select(
          "client_id, project_id, status, priority, created_at, resolved_at",
        ),
    ]);

  const allClients = (clientsRes.data ?? []) as unknown as ClientDbRow[];
  const projectLinks =
    (projectsRes.data ?? []) as unknown as ProjectClientLink[];
  const healthLinks = (healthRes.data ?? []) as unknown as HealthLink[];
  const npsAll = (npsRes.data ?? []) as unknown as NpsRowFromDb[];
  const ticketsAll = (ticketsRes.data ?? []) as unknown as TicketRowFromDb[];

  // Contador de projects por client_id.
  const projectsByClient = new Map<string, number>();
  for (const link of projectLinks) {
    if (!link.client_id) continue;
    projectsByClient.set(
      link.client_id,
      (projectsByClient.get(link.client_id) ?? 0) + 1,
    );
  }

  // Health por client_id (unique en 0110 → max 1 fila por cliente).
  const healthByClient = new Map<
    string,
    {
      status: RelationshipStatus;
      score: number | null;
      lastContactAt: string | null;
    }
  >();
  for (const h of healthLinks) {
    healthByClient.set(h.client_id, {
      status: h.relationship_status,
      score: h.health_score,
      lastContactAt: h.last_contact_at,
    });
  }

  // Agrupamos NPS y tickets por client_id para computar el score de cada
  // cliente en O(N+M) en vez de filtrar por cliente en cada iteración.
  const npsByClient = new Map<string, NpsRowFromDb[]>();
  for (const r of npsAll) {
    const arr = npsByClient.get(r.client_id) ?? [];
    arr.push(r);
    npsByClient.set(r.client_id, arr);
  }
  const ticketsByClient = new Map<string, TicketRowFromDb[]>();
  for (const t of ticketsAll) {
    const arr = ticketsByClient.get(t.client_id) ?? [];
    arr.push(t);
    ticketsByClient.set(t.client_id, arr);
  }

  const activeCount = allClients.filter((c) => c.active).length;
  const inactiveCount = allClients.length - activeCount;

  const filtered = allClients.filter((c) => {
    if (show === "active") return c.active;
    if (show === "inactive") return !c.active;
    return true;
  });

  const rows: ClientRowData[] = filtered.map((c) => {
    const h = healthByClient.get(c.id);
    const clientNps = npsByClient.get(c.id) ?? [];
    const clientTickets = ticketsByClient.get(c.id) ?? [];
    const computed = computeHealthScore({
      nps: clientNps,
      lastContactAt: h?.lastContactAt ?? null,
      tickets: clientTickets,
    });

    // Regla del override: si health.score no es null, gana. Si es null,
    // usamos el compuesto — SIEMPRE calculable porque el ticketsComponent
    // siempre existe (0 urgentes = 100).
    const scoreKind: "manual" | "compuesto" =
      h?.score != null ? "manual" : "compuesto";
    const effectiveScore = h?.score != null ? h.score : computed.score;

    return {
      id: c.id,
      name: c.name,
      businessName: c.business_name,
      industry: c.industry,
      notes: c.notes,
      active: c.active,
      projectsCount: projectsByClient.get(c.id) ?? 0,
      relationshipStatus: h?.status ?? null,
      healthScore: effectiveScore,
      healthScoreKind: scoreKind,
      healthScoreLimited: scoreKind === "compuesto" && computed.isLimited,
    };
  });

  const withHealth = allClients.filter((c) => healthByClient.has(c.id)).length;
  const enRiesgo = Array.from(healthByClient.values()).filter(
    (h) => h.status === "en_riesgo",
  ).length;

  function buildHref(nextShow: ShowFilter): string {
    const params = new URLSearchParams();
    if (nextShow !== "active") params.set("show", nextShow);
    const qs = params.toString();
    return qs ? `/clientes?${qs}` : "/clientes";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconCli size={16} />}
        title="Clientes"
        stats={[
          { l: "Total", v: fCount(allClients.length) },
          { l: "Activos", v: fCount(activeCount) },
          { l: "Con health", v: fCount(withHealth) },
          { l: "En riesgo", v: fCount(enRiesgo) },
        ]}
      />

      <KgParamPills
        ariaLabel="Filtrar por estado"
        options={SHOW_OPTIONS.map((o) => ({
          label: o.label,
          href: buildHref(o.value),
          active: show === o.value,
        }))}
      />

      <Panel title="Clientes gestionados">
        <ClientesView rows={rows} totalCount={rows.length} />
      </Panel>
    </div>
  );
}

function parseShow(v: string | string[] | undefined): ShowFilter {
  if (typeof v !== "string") return "active";
  if (v === "inactive" || v === "all") return v;
  return "active";
}
