import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ContextBar } from "@/components/kg/context-bar";
import { IconCli } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { StatusPill } from "@/components/kg/status-pill";
import {
  computeHealthScore,
  daysSinceLastContact,
} from "@/lib/clients/health";
import type {
  RelationshipStatus,
  RenewalStatus,
  TicketPriority,
  TicketStatus,
  UpsellStatus,
} from "@/lib/clients/types";
import { createClient } from "@/lib/supabase/server";

import {
  NpsSummary,
  RenewalsSummary,
  TicketsSummary,
  UpsellsSummary,
  type NpsSummaryItem,
  type RenewalSummaryItem,
  type TicketSummaryItem,
  type UpsellSummaryItem,
} from "./activity-summary";
import type { AvailableProject } from "./attach-project-drawer";
import {
  HealthPanel,
  type HealthComputed,
  type HealthCurrent,
} from "./health-panel";
import { ProjectsPanel, type AttachedProject } from "./projects-panel";

export const metadata: Metadata = { title: "Cliente · Clientes" };

interface ClientDbRow {
  readonly id: string;
  readonly name: string;
  readonly business_name: string | null;
  readonly industry: string | null;
  readonly notes: string | null;
  readonly active: boolean;
}

interface ProjectDbRow {
  readonly id: string;
  readonly name: string;
  readonly business_name: string | null;
  readonly ownership: "propia" | "externa";
}

interface HealthDbRow {
  readonly relationship_status: RelationshipStatus;
  readonly health_score: number | null;
  readonly last_contact_at: string | null;
  readonly notes: string | null;
}

interface TicketDbRow {
  readonly id: string;
  readonly title: string;
  readonly project_id: string | null;
  readonly status: TicketStatus;
  readonly priority: TicketPriority;
  readonly due_date: string | null;
  readonly resolved_at: string | null;
  readonly created_at: string;
}

interface NpsDbRow {
  readonly id: string;
  readonly respondent_name: string | null;
  readonly respondent_email: string | null;
  readonly score: number;
  readonly responded_at: string;
}

interface RenewalDbRow {
  readonly id: string;
  readonly period_start: string;
  readonly period_end: string;
  readonly amount: number | string;
  readonly currency: string;
  readonly status: RenewalStatus;
  readonly collected_at: string | null;
}

interface UpsellDbRow {
  readonly id: string;
  readonly title: string;
  readonly amount: number | string;
  readonly currency: string;
  readonly status: UpsellStatus;
  readonly closed_at: string | null;
  readonly created_at: string;
}

const STATUS_LABEL: Record<RelationshipStatus, string> = {
  onboarding: "Onboarding",
  activa: "Activa",
  en_riesgo: "En riesgo",
  perdida: "Perdida",
};

// ═══════════════════════════════════════════════════════════════════════════
// Ficha del cliente gestionado.
//
// Trae:
//   - El cliente (rebota con notFound si no existe o no hay permisos).
//   - Los projects atados (client_id = clientId).
//   - Los projects disponibles para atar (client_id IS NULL).
//   - project_health del cliente (opcional — puede no existir).
//
// El bloque de LTV / historial de tickets/renewals/upsells/nps llega en
// commits siguientes. Hoy: Datos + Health + Projects atados.
// ═══════════════════════════════════════════════════════════════════════════

export default async function ClienteFichaPage({
  params,
}: {
  readonly params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;

  const supabase = await createClient();

  const [
    clientRes,
    attachedRes,
    availableRes,
    healthRes,
    npsRes,
    ticketsRes,
    renewalsRes,
    upsellsRes,
  ] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, business_name, industry, notes, active")
      .eq("id", clientId)
      .maybeSingle(),
    supabase
      .from("projects")
      .select("id, name, business_name, ownership")
      .eq("client_id", clientId)
      .order("name", { ascending: true }),
    supabase
      .from("projects")
      .select("id, name, business_name, ownership")
      .is("client_id", null)
      .order("name", { ascending: true }),
    supabase
      .from("project_health")
      .select("relationship_status, health_score, last_contact_at, notes")
      .eq("client_id", clientId)
      .maybeSingle(),
    // NPS del cliente — alimenta computeHealthScore + la sub-sección NPS.
    supabase
      .from("nps_responses")
      .select("id, respondent_name, respondent_email, score, responded_at")
      .eq("client_id", clientId),
    // Tickets del cliente — alimenta computeHealthScore + la sub-sección.
    supabase
      .from("tickets")
      .select("id, title, project_id, status, priority, due_date, resolved_at, created_at")
      .eq("client_id", clientId),
    // Renewals del cliente — para la sub-sección Renovaciones.
    supabase
      .from("renewals")
      .select("id, period_start, period_end, amount, currency, status, collected_at")
      .eq("client_id", clientId),
    // Upsells del cliente — para la sub-sección Upsells.
    supabase
      .from("upsells")
      .select("id, title, amount, currency, status, closed_at, created_at")
      .eq("client_id", clientId),
  ]);

  const client = clientRes.data as ClientDbRow | null;
  if (!client) notFound();

  const attached: AttachedProject[] = (
    (attachedRes.data ?? []) as unknown as ProjectDbRow[]
  ).map((p) => ({
    id: p.id,
    name: p.name,
    businessName: p.business_name,
    ownership: p.ownership,
  }));

  const available: AvailableProject[] = (
    (availableRes.data ?? []) as unknown as ProjectDbRow[]
  ).map((p) => ({
    id: p.id,
    name: p.name,
    businessName: p.business_name,
    ownership: p.ownership,
  }));

  const healthRow = healthRes.data as HealthDbRow | null;
  const health: HealthCurrent | null = healthRow
    ? {
        relationshipStatus: healthRow.relationship_status,
        healthScore: healthRow.health_score,
        lastContactAt: healthRow.last_contact_at,
        notes: healthRow.notes,
      }
    : null;

  // Health score compuesto (fórmula plan §1.4). Se usa como fallback
  // cuando health.healthScore es null (sin override manual). También lo
  // consumimos para el stat "Health" del ContextBar.
  const npsRawRows = (npsRes.data ?? []) as unknown as NpsDbRow[];
  const ticketsRawRows = (ticketsRes.data ?? []) as unknown as TicketDbRow[];
  const computedBreakdown = computeHealthScore({
    nps: npsRawRows.map((r) => ({
      client_id: clientId,
      score: r.score,
      responded_at: r.responded_at,
    })),
    lastContactAt: health?.lastContactAt ?? null,
    tickets: ticketsRawRows.map((t) => ({
      client_id: clientId,
      project_id: t.project_id,
      status: t.status,
      priority: t.priority,
      created_at: t.created_at,
      resolved_at: t.resolved_at,
    })),
  });
  const computed: HealthComputed = {
    score: computedBreakdown.score,
    isLimited: computedBreakdown.isLimited,
    npsComponent: computedBreakdown.npsComponent,
    contactComponent: computedBreakdown.contactComponent,
    ticketsComponent: computedBreakdown.ticketsComponent,
  };

  const scoreLabel =
    health == null
      ? "—"
      : health.healthScore != null
        ? `${health.healthScore}`
        : `${computed.score}${computed.isLimited ? "*" : ""}`;

  const daysSince = health
    ? daysSinceLastContact({ last_contact_at: health.lastContactAt })
    : null;
  const contactStat =
    daysSince == null
      ? "—"
      : daysSince === 0
        ? "hoy"
        : daysSince === 1
          ? "hace 1 día"
          : `hace ${daysSince} días`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconCli size={16} />}
        title={client.name}
        stats={[
          { l: "Projects", v: String(attached.length) },
          {
            l: "Estado",
            v: health ? STATUS_LABEL[health.relationshipStatus] : "—",
          },
          { l: "Health", v: scoreLabel },
          { l: "Último contacto", v: contactStat },
        ]}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          gap: 16,
        }}
      >
        <Panel title="Datos del cliente">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <FieldRow
              label="Razón social"
              value={client.business_name ?? "—"}
            />
            <FieldRow label="Industria" value={client.industry ?? "—"} />
            <FieldRow
              label="Registro"
              value={
                <StatusPill
                  text={client.active ? "Activo" : "Archivado"}
                  tone={
                    client.active
                      ? "var(--kg-positive-500)"
                      : "var(--kg-neutral-500)"
                  }
                />
              }
            />
            {client.notes && (
              <FieldRow label="Notas" value={client.notes} multiline />
            )}
            <div style={{ marginTop: 4 }}>
              <Link
                href="/clientes"
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
                }}
              >
                ← Volver al listado
              </Link>
            </div>
          </div>
        </Panel>

        <Panel title="Health de la relación">
          <HealthPanel
            clientId={client.id}
            clientName={client.name}
            current={health}
            computed={computed}
          />
        </Panel>
      </div>

      <Panel title="Projects atados">
        <ProjectsPanel
          clientId={client.id}
          attached={attached}
          available={available}
        />
      </Panel>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 16,
        }}
      >
        <TicketsSummary
          clientId={client.id}
          tickets={ticketsRawRows.map<TicketSummaryItem>((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            priority: t.priority,
            dueDate: t.due_date,
            createdAt: t.created_at,
          }))}
        />
        <RenewalsSummary
          clientId={client.id}
          renewals={(
            (renewalsRes.data ?? []) as unknown as RenewalDbRow[]
          ).map<RenewalSummaryItem>((r) => ({
            id: r.id,
            periodStart: r.period_start,
            periodEnd: r.period_end,
            amount: Number(r.amount),
            currency: r.currency === "USD" ? "USD" : "ARS",
            status: r.status,
            collectedAt: r.collected_at,
          }))}
        />
        <UpsellsSummary
          clientId={client.id}
          upsells={(
            (upsellsRes.data ?? []) as unknown as UpsellDbRow[]
          ).map<UpsellSummaryItem>((u) => ({
            id: u.id,
            title: u.title,
            amount: Number(u.amount),
            currency: u.currency === "USD" ? "USD" : "ARS",
            status: u.status,
            closedAt: u.closed_at,
            createdAt: u.created_at,
          }))}
        />
        <NpsSummary
          clientId={client.id}
          nps={npsRawRows.map<NpsSummaryItem>((r) => ({
            id: r.id,
            respondentName: r.respondent_name,
            respondentEmail: r.respondent_email,
            score: r.score,
            respondedAt: r.responded_at,
          }))}
        />
      </div>
    </div>
  );
}

function FieldRow({
  label,
  value,
  multiline,
}: {
  readonly label: string;
  readonly value: React.ReactNode;
  readonly multiline?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div
        className="kg-t7"
        style={{ color: "var(--kg-text-3)", fontWeight: 600 }}
      >
        {label}
      </div>
      <div
        style={{
          color: "var(--kg-text-1)",
          fontSize: 13,
          lineHeight: multiline ? 1.55 : 1.4,
          whiteSpace: multiline ? "pre-wrap" : "normal",
        }}
      >
        {value}
      </div>
    </div>
  );
}
