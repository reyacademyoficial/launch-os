import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconCli } from "@/components/kg/icons";
import { KgPageFilters } from "@/components/kg/page-menu";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";
import type { RenewalStatus } from "@/lib/clients/types";
import { createClient } from "@/lib/supabase/server";

import type { ClientOptionForRenewal } from "./renewal-form-drawer";
import {
  RenewalsView,
  fMoneyCur,
  type RenewalRowData,
} from "./renewals-view";

export const metadata: Metadata = { title: "Renovaciones · Clientes" };

// ═══════════════════════════════════════════════════════════════════════════
// Vista global de renewals.
//
// Filtros por searchParams:
//   ?status=pipeline|cobradas|perdidas|todas    default pipeline
//   ?clientId=<uuid>                             opcional
//
// Stats de header sobre TODAS las renewals (no filtradas): pipeline
// (count), cobrado en total (sum de amounts en ARS-equivalente
// aproximado — hoy sin FX; el número real por moneda vive en la vista),
// perdidas (count).
// ═══════════════════════════════════════════════════════════════════════════

type StatusFilter = "pipeline" | "cobradas" | "perdidas" | "todas";

const STATUS_FILTER_OPTIONS: ReadonlyArray<{
  value: StatusFilter;
  label: string;
}> = [
  { value: "pipeline", label: "Pipeline" },
  { value: "cobradas", label: "Cobradas" },
  { value: "perdidas", label: "Perdidas" },
  { value: "todas", label: "Todas" },
];

const PIPELINE_STATUSES: ReadonlySet<RenewalStatus> = new Set([
  "propuesta",
  "confirmada",
  "facturada",
]);

interface RenewalDbRow {
  readonly id: string;
  readonly client_id: string;
  readonly period_start: string;
  readonly period_end: string;
  readonly amount: number | string;
  readonly currency: "ARS" | "USD" | string;
  readonly status: RenewalStatus;
  readonly collected_at: string | null;
  readonly loss_reason: string | null;
  readonly notes: string | null;
}

interface ClientDbRow {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
}

export default async function RenovacionesPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const statusFilter = parseStatus(sp.status);
  const clientIdFilter = parseClientId(sp.clientId);

  const supabase = await createClient();

  const [renewalsRes, clientsRes] = await Promise.all([
    supabase
      .from("renewals")
      .select(
        "id, client_id, period_start, period_end, amount, currency, status, collected_at, loss_reason, notes",
      )
      .order("period_end", { ascending: false }),
    supabase
      .from("clients")
      .select("id, name, active")
      .order("name", { ascending: true }),
  ]);

  const allRenewals =
    (renewalsRes.data ?? []) as unknown as RenewalDbRow[];
  const allClients = (clientsRes.data ?? []) as unknown as ClientDbRow[];

  const clientNameById = new Map<string, string>();
  for (const c of allClients) clientNameById.set(c.id, c.name);

  const clientOptions: ClientOptionForRenewal[] = allClients
    .filter((c) => c.active)
    .map((c) => ({ id: c.id, name: c.name }));

  const filtered = allRenewals.filter((r) => {
    if (statusFilter === "pipeline" && !PIPELINE_STATUSES.has(r.status))
      return false;
    if (statusFilter === "cobradas" && r.status !== "cobrada") return false;
    if (statusFilter === "perdidas" && r.status !== "perdida") return false;
    if (clientIdFilter != null && r.client_id !== clientIdFilter) return false;
    return true;
  });

  const rows: RenewalRowData[] = filtered.map((r) => ({
    id: r.id,
    clientId: r.client_id,
    clientName: clientNameById.get(r.client_id) ?? "—",
    periodStart: r.period_start,
    periodEnd: r.period_end,
    amount: Number(r.amount),
    currency: r.currency === "USD" ? "USD" : "ARS",
    status: r.status,
    collectedAt: r.collected_at,
    lossReason: r.loss_reason,
    notes: r.notes,
  }));

  // Stats sobre TODAS las renewals (no filtradas).
  const pipelineCount = allRenewals.filter((r) =>
    PIPELINE_STATUSES.has(r.status),
  ).length;
  const cobradaArs = allRenewals
    .filter((r) => r.status === "cobrada" && r.currency === "ARS")
    .reduce((acc, r) => acc + Number(r.amount), 0);
  const cobradaUsd = allRenewals
    .filter((r) => r.status === "cobrada" && r.currency === "USD")
    .reduce((acc, r) => acc + Number(r.amount), 0);
  const perdidasCount = allRenewals.filter(
    (r) => r.status === "perdida",
  ).length;

  function buildHref(overrides: {
    status?: StatusFilter;
    clientId?: string | null;
  }): string {
    const nextStatus = overrides.status ?? statusFilter;
    const nextClientId =
      overrides.clientId !== undefined ? overrides.clientId : clientIdFilter;
    const params = new URLSearchParams();
    if (nextStatus !== "pipeline") params.set("status", nextStatus);
    if (nextClientId != null) params.set("clientId", nextClientId);
    const qs = params.toString();
    return qs ? `/clientes/renovaciones?${qs}` : "/clientes/renovaciones";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconCli size={16} />}
        title="Renovaciones"
        stats={[
          { l: "Pipeline", v: fCount(pipelineCount) },
          {
            l: "Cobrado ARS",
            v: cobradaArs === 0 ? "—" : fMoneyCur(cobradaArs, "ARS"),
          },
          {
            l: "Cobrado USD",
            v: cobradaUsd === 0 ? "—" : fMoneyCur(cobradaUsd, "USD"),
          },
          { l: "Perdidas", v: fCount(perdidasCount) },
        ]}
      />

      <KgPageFilters>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <KgParamPills
            ariaLabel="Filtrar por estado"
            options={STATUS_FILTER_OPTIONS.map((o) => ({
              label: o.label,
              href: buildHref({ status: o.value }),
              active: statusFilter === o.value,
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

      <Panel title="Renovaciones">
        <RenewalsView
          rows={rows}
          totalCount={rows.length}
          clients={clientOptions}
          presetClientId={clientIdFilter}
        />
      </Panel>
    </div>
  );
}

function parseStatus(v: string | string[] | undefined): StatusFilter {
  if (typeof v !== "string") return "pipeline";
  if (v === "cobradas" || v === "perdidas" || v === "todas") return v;
  return "pipeline";
}

function parseClientId(v: string | string[] | undefined): string | null {
  if (typeof v !== "string" || v.length === 0) return null;
  return v;
}
