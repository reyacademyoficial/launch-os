import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconCli } from "@/components/kg/icons";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";
import type { UpsellStatus } from "@/lib/clients/types";
import { createClient } from "@/lib/supabase/server";

import type { ClientOptionForUpsell } from "./upsell-form-drawer";
import { UpsellsView, fMoneyCur, type UpsellRowData } from "./upsells-view";

export const metadata: Metadata = { title: "Upsells · Clientes" };

// ═══════════════════════════════════════════════════════════════════════════
// Vista global de upsells. Simétrica a renovaciones/page.tsx.
// ═══════════════════════════════════════════════════════════════════════════

type StatusFilter = "pipeline" | "cobrados" | "perdidos" | "todos";

const STATUS_FILTER_OPTIONS: ReadonlyArray<{
  value: StatusFilter;
  label: string;
}> = [
  { value: "pipeline", label: "Pipeline" },
  { value: "cobrados", label: "Cobrados" },
  { value: "perdidos", label: "Perdidos" },
  { value: "todos", label: "Todos" },
];

const PIPELINE_STATUSES: ReadonlySet<UpsellStatus> = new Set([
  "propuesta",
  "confirmada",
  "facturada",
]);

interface UpsellDbRow {
  readonly id: string;
  readonly client_id: string;
  readonly title: string;
  readonly description: string | null;
  readonly category: string | null;
  readonly amount: number | string;
  readonly currency: "ARS" | "USD" | string;
  readonly status: UpsellStatus;
  readonly closed_at: string | null;
  readonly loss_reason: string | null;
  readonly notes: string | null;
}

interface ClientDbRow {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
}

export default async function UpsellsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const statusFilter = parseStatus(sp.status);
  const clientIdFilter = parseClientId(sp.clientId);

  const supabase = await createClient();

  const [upsellsRes, clientsRes] = await Promise.all([
    supabase
      .from("upsells")
      .select(
        "id, client_id, title, description, category, amount, currency, status, closed_at, loss_reason, notes",
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("clients")
      .select("id, name, active")
      .order("name", { ascending: true }),
  ]);

  const allUpsells = (upsellsRes.data ?? []) as unknown as UpsellDbRow[];
  const allClients = (clientsRes.data ?? []) as unknown as ClientDbRow[];

  const clientNameById = new Map<string, string>();
  for (const c of allClients) clientNameById.set(c.id, c.name);

  const clientOptions: ClientOptionForUpsell[] = allClients
    .filter((c) => c.active)
    .map((c) => ({ id: c.id, name: c.name }));

  const filtered = allUpsells.filter((u) => {
    if (statusFilter === "pipeline" && !PIPELINE_STATUSES.has(u.status))
      return false;
    if (statusFilter === "cobrados" && u.status !== "cobrada") return false;
    if (statusFilter === "perdidos" && u.status !== "perdida") return false;
    if (clientIdFilter != null && u.client_id !== clientIdFilter) return false;
    return true;
  });

  const rows: UpsellRowData[] = filtered.map((u) => ({
    id: u.id,
    clientId: u.client_id,
    clientName: clientNameById.get(u.client_id) ?? "—",
    title: u.title,
    description: u.description,
    category: u.category,
    amount: Number(u.amount),
    currency: u.currency === "USD" ? "USD" : "ARS",
    status: u.status,
    closedAt: u.closed_at,
    lossReason: u.loss_reason,
    notes: u.notes,
  }));

  const pipelineCount = allUpsells.filter((u) =>
    PIPELINE_STATUSES.has(u.status),
  ).length;
  const cobradoArs = allUpsells
    .filter((u) => u.status === "cobrada" && u.currency === "ARS")
    .reduce((acc, u) => acc + Number(u.amount), 0);
  const cobradoUsd = allUpsells
    .filter((u) => u.status === "cobrada" && u.currency === "USD")
    .reduce((acc, u) => acc + Number(u.amount), 0);
  const perdidosCount = allUpsells.filter(
    (u) => u.status === "perdida",
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
    return qs ? `/clientes/upsells?${qs}` : "/clientes/upsells";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconCli size={16} />}
        title="Upsells"
        stats={[
          { l: "Pipeline", v: fCount(pipelineCount) },
          {
            l: "Cobrado ARS",
            v: cobradoArs === 0 ? "—" : fMoneyCur(cobradoArs, "ARS"),
          },
          {
            l: "Cobrado USD",
            v: cobradoUsd === 0 ? "—" : fMoneyCur(cobradoUsd, "USD"),
          },
          { l: "Perdidos", v: fCount(perdidosCount) },
        ]}
      />

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

      <Panel title="Upsells">
        <UpsellsView
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
  if (v === "cobrados" || v === "perdidos" || v === "todos") return v;
  return "pipeline";
}

function parseClientId(v: string | string[] | undefined): string | null {
  if (typeof v !== "string" || v.length === 0) return null;
  return v;
}
