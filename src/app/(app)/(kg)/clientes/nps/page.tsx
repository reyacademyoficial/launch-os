import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconCli } from "@/components/kg/icons";
import { KgPageFilters } from "@/components/kg/page-menu";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { computeNps } from "@/lib/clients/health";
import { fCount } from "@/lib/finance/format";
import type { NpsResponseRow } from "@/lib/clients/types";
import { createClient } from "@/lib/supabase/server";

import type { ClientOptionForNps } from "./nps-form-drawer";
import { NpsView, type NpsRowData } from "./nps-view";

export const metadata: Metadata = { title: "NPS · Clientes" };

// ═══════════════════════════════════════════════════════════════════════════
// Vista global de respuestas NPS.
//
// Filtros por searchParams:
//   ?range=30d|90d|365d|todo   default 90d (ventana estándar del NPS)
//   ?clientId=<uuid>            opcional
//
// El header muestra el NPS score COMPUTADO sobre la ventana filtrada
// (reutilizando computeNps de src/lib/clients/health.ts). No es un simple
// promedio: es (%promoters − %detractors) × 100.
// ═══════════════════════════════════════════════════════════════════════════

type RangeFilter = "30d" | "90d" | "365d" | "todo";

const RANGE_OPTIONS: ReadonlyArray<{ value: RangeFilter; label: string }> = [
  { value: "30d", label: "30 días" },
  { value: "90d", label: "90 días" },
  { value: "365d", label: "1 año" },
  { value: "todo", label: "Todo" },
];

const RANGE_DAYS: Record<Exclude<RangeFilter, "todo">, number> = {
  "30d": 30,
  "90d": 90,
  "365d": 365,
};

interface NpsDbRow {
  readonly id: string;
  readonly client_id: string;
  readonly respondent_name: string | null;
  readonly respondent_email: string | null;
  readonly score: number;
  readonly comment: string | null;
  readonly channel: string | null;
  readonly responded_at: string;
}

interface ClientDbRow {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
}

export default async function NpsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const rangeFilter = parseRange(sp.range);
  const clientIdFilter = parseClientId(sp.clientId);

  const supabase = await createClient();

  const [npsRes, clientsRes] = await Promise.all([
    supabase
      .from("nps_responses")
      .select(
        "id, client_id, respondent_name, respondent_email, score, comment, channel, responded_at",
      )
      .order("responded_at", { ascending: false }),
    supabase
      .from("clients")
      .select("id, name, active")
      .order("name", { ascending: true }),
  ]);

  const allNps = (npsRes.data ?? []) as unknown as NpsDbRow[];
  const allClients = (clientsRes.data ?? []) as unknown as ClientDbRow[];

  const clientNameById = new Map<string, string>();
  for (const c of allClients) clientNameById.set(c.id, c.name);

  const clientOptions: ClientOptionForNps[] = allClients
    .filter((c) => c.active)
    .map((c) => ({ id: c.id, name: c.name }));

  const cutoff = rangeCutoff(rangeFilter);

  const filtered = allNps.filter((r) => {
    if (cutoff != null && r.responded_at < cutoff) return false;
    if (clientIdFilter != null && r.client_id !== clientIdFilter) return false;
    return true;
  });

  const rows: NpsRowData[] = filtered.map((r) => ({
    id: r.id,
    clientId: r.client_id,
    clientName: clientNameById.get(r.client_id) ?? "—",
    respondentName: r.respondent_name,
    respondentEmail: r.respondent_email,
    score: r.score,
    comment: r.comment,
    channel: r.channel,
    respondedAt: r.responded_at,
  }));

  // NPS agregado sobre las respuestas visibles (reutiliza el selector puro
  // de src/lib/clients/health.ts). Se pasa el subset filtrado, no todas.
  const npsInputs: NpsResponseRow[] = filtered.map((r) => ({
    client_id: r.client_id,
    score: r.score,
    responded_at: r.responded_at,
  }));
  const npsBreakdown = computeNps(npsInputs);

  function buildHref(overrides: {
    range?: RangeFilter;
    clientId?: string | null;
  }): string {
    const nextRange = overrides.range ?? rangeFilter;
    const nextClientId =
      overrides.clientId !== undefined ? overrides.clientId : clientIdFilter;
    const params = new URLSearchParams();
    if (nextRange !== "90d") params.set("range", nextRange);
    if (nextClientId != null) params.set("clientId", nextClientId);
    const qs = params.toString();
    return qs ? `/clientes/nps?${qs}` : "/clientes/nps";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconCli size={16} />}
        title="NPS"
        stats={[
          { l: "Respuestas", v: fCount(rows.length) },
          {
            l: "NPS score",
            v:
              npsBreakdown.npsScore == null
                ? "—"
                : Math.round(npsBreakdown.npsScore).toString(),
          },
          { l: "Promotores", v: fCount(npsBreakdown.promoters) },
          { l: "Detractores", v: fCount(npsBreakdown.detractors) },
        ]}
      />

      <KgPageFilters
        activeCount={
          (rangeFilter !== "90d" ? 1 : 0) +
          (clientIdFilter != null ? 1 : 0)
        }
      >
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <KgParamPills
            ariaLabel="Filtrar por período"
            options={RANGE_OPTIONS.map((o) => ({
              label: o.label,
              href: buildHref({ range: o.value }),
              active: rangeFilter === o.value,
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

      <Panel title="Respuestas NPS">
        <NpsView
          rows={rows}
          totalCount={rows.length}
          clients={clientOptions}
          presetClientId={clientIdFilter}
        />
      </Panel>
    </div>
  );
}

function parseRange(v: string | string[] | undefined): RangeFilter {
  if (typeof v !== "string") return "90d";
  if (v === "30d" || v === "365d" || v === "todo") return v;
  return "90d";
}

function parseClientId(v: string | string[] | undefined): string | null {
  if (typeof v !== "string" || v.length === 0) return null;
  return v;
}

function rangeCutoff(range: RangeFilter): string | null {
  if (range === "todo") return null;
  const days = RANGE_DAYS[range];
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}
