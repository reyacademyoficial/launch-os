import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { KgDataTable, type Column } from "@/components/kg/data-table";
import { IconFin } from "@/components/kg/icons";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { listBanks } from "@/lib/banks/list";
import { fCount, fMoney } from "@/lib/finance/format";
import { resolvePeriod, type Period } from "@/lib/finance/period";
import { createClient } from "@/lib/supabase/server";

import { PendingPanel } from "./pending-panel";
import type {
  BankOption,
  PendingSettlement,
} from "./transfer-drawer";

export const metadata: Metadata = { title: "Transferencias · Financiero" };

type DirectionParam = "todos" | "a_favor_cliente" | "transferido";
type RangeParam = "todo" | "mes-actual" | "mes-anterior" | "90d";

const DIRECTION_OPTIONS: ReadonlyArray<{
  value: DirectionParam;
  label: string;
}> = [
  { value: "todos", label: "Todos" },
  { value: "a_favor_cliente", label: "A favor del cliente" },
  { value: "transferido", label: "Transferidos" },
];
const RANGE_OPTIONS: ReadonlyArray<{ value: RangeParam; label: string }> = [
  { value: "todo", label: "Todo" },
  { value: "mes-actual", label: "Mes actual" },
  { value: "mes-anterior", label: "Mes anterior" },
  { value: "90d", label: "90 días" },
];

interface TransferDbRow {
  readonly id: string;
  readonly project_id: string;
  readonly launch_settlement_id: string | null;
  readonly bank_movement_id: string | null;
  readonly amount: number;
  readonly direction: "a_favor_cliente" | "transferido";
  readonly date: string;
  readonly notes: string | null;
}

interface ProjectNameRow {
  readonly id: string;
  readonly name: string;
}

export default async function TransferenciasPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const directionParam = parseDirection(sp.direction);
  const rangeParam = parseRange(sp.range);

  const period: Period | null =
    rangeParam === "todo" ? null : resolvePeriod({ range: rangeParam });

  const supabase = await createClient();
  let query = supabase
    .from("client_transfers")
    .select(
      "id, project_id, launch_settlement_id, bank_movement_id, amount, direction, date, notes",
    )
    .order("date", { ascending: false });

  if (directionParam !== "todos") query = query.eq("direction", directionParam);
  if (period) {
    query = query.gte("date", period.fromYmd).lte("date", period.toYmd);
  }

  const res = await query;
  const transfers = (res.data ?? []) as unknown as TransferDbRow[];

  const projectIds = Array.from(new Set(transfers.map((t) => t.project_id)));
  const projectsRes =
    projectIds.length > 0
      ? await supabase.from("projects").select("id, name").in("id", projectIds)
      : { data: [] as ProjectNameRow[] };
  const projectNameById = new Map<string, string>(
    ((projectsRes.data ?? []) as ProjectNameRow[]).map((p) => [p.id, p.name]),
  );

  const totalCount = transfers.length;
  const aFavor = transfers
    .filter((t) => t.direction === "a_favor_cliente")
    .reduce((a, t) => a + Number(t.amount), 0);
  const transferido = transfers
    .filter((t) => t.direction === "transferido")
    .reduce((a, t) => a + Number(t.amount), 0);
  const saldo = aFavor - transferido;

  // ─── Settlements pendientes de transferir ─────────────────────────────
  // Traemos TODOS los client_transfers (sin filtros de UI) para calcular
  // el pendiente por settlement — el filtro de la lista histórica es
  // ortogonal a esta agregación. Duplicamos la query cruda para no
  // mezclar responsabilidades: la tabla de arriba mira TODO, la tabla de
  // abajo mira lo filtrado por la UI.
  const [allTransfersRes, settlementsRes, banksRes, allProjectsRes] =
    await Promise.all([
      supabase
        .from("client_transfers")
        .select("launch_settlement_id, amount, direction"),
      // Settlements liquidados de proyectos externos — candidatos a transferir.
      supabase
        .from("launch_settlements")
        .select(
          "id, project_id, launch_id, closed_at, owed_to_client, status",
        )
        .eq("status", "liquidada")
        .gt("owed_to_client", 0),
      listBanks(),
      supabase.from("projects").select("id, name, ownership"),
    ]);

  interface SettlementRow {
    readonly id: string;
    readonly project_id: string;
    readonly launch_id: string;
    readonly closed_at: string | null;
    readonly owed_to_client: number;
    readonly status: string;
  }
  interface ProjectRow {
    readonly id: string;
    readonly name: string;
    readonly ownership: "propia" | "externa";
  }
  interface TransferAggRow {
    readonly launch_settlement_id: string | null;
    readonly amount: number;
    readonly direction: "a_favor_cliente" | "transferido";
  }

  const settlements =
    (settlementsRes.data ?? []) as unknown as SettlementRow[];
  const allTransfers =
    (allTransfersRes.data ?? []) as unknown as TransferAggRow[];
  const allProjects =
    (allProjectsRes.data ?? []) as unknown as ProjectRow[];
  const projectFullById = new Map(allProjects.map((p) => [p.id, p]));

  // Saldo pendiente por settlement = Σ a_favor_cliente − Σ transferido.
  // Espeja exactamente el cálculo de la RPC 0102.
  const pendingBySettlementId = new Map<string, number>();
  for (const t of allTransfers) {
    if (!t.launch_settlement_id) continue;
    const cur = pendingBySettlementId.get(t.launch_settlement_id) ?? 0;
    const delta =
      t.direction === "a_favor_cliente"
        ? Number(t.amount)
        : -Number(t.amount);
    pendingBySettlementId.set(t.launch_settlement_id, cur + delta);
  }

  // Nombres de launches referenciados por los pendientes (query aparte,
  // solo por los que necesito). Si RLS de launches bloquea alguno, cae al
  // fallback "Lanzamiento ..." como en el resto del módulo.
  const pendingLaunchIds = Array.from(
    new Set(settlements.map((s) => s.launch_id)),
  );
  const launchNamesRes =
    pendingLaunchIds.length > 0
      ? await supabase
          .from("launches")
          .select("id, name")
          .in("id", pendingLaunchIds)
      : { data: [] as Array<{ id: string; name: string | null }> };
  const launchNameById = new Map<string, string>(
    ((launchNamesRes.data ?? []) as Array<{
      id: string;
      name: string | null;
    }>).map((l) => [l.id, l.name ?? `Lanzamiento ${l.id.slice(0, 6)}`]),
  );

  // Filtro final: solo settlements de proyecto EXTERNO con pendiente > 0.
  // Los propios nunca aparecen (la RPC 0102 los rechaza igual).
  const pendingSettlements: PendingSettlement[] = settlements
    .map((s): PendingSettlement | null => {
      const project = projectFullById.get(s.project_id);
      if (!project || project.ownership !== "externa") return null;
      const pending = pendingBySettlementId.get(s.id) ?? 0;
      if (pending <= 0) return null;
      return {
        id: s.id,
        projectName: project.name,
        launchName: launchNameById.get(s.launch_id) ?? "—",
        pending,
        closedAt: s.closed_at,
      };
    })
    .filter((r): r is PendingSettlement => r !== null)
    .sort((a, b) => b.pending - a.pending);

  const banksForDrawer: BankOption[] = banksRes.map((b) => ({
    id: b.id,
    name: b.name,
    active: b.active,
  }));

  const pendingCount = pendingSettlements.length;
  const pendingTotal = pendingSettlements.reduce(
    (acc, p) => acc + p.pending,
    0,
  );

  interface Row {
    readonly id: string;
    readonly date: string;
    readonly project: string;
    readonly direction: "a_favor_cliente" | "transferido";
    readonly amount: number;
    readonly hasSettlement: boolean;
    readonly hasBankMovement: boolean;
    readonly notes: string;
  }
  const rows: Row[] = transfers.map((t) => ({
    id: t.id,
    date: t.date,
    project: projectNameById.get(t.project_id) ?? "—",
    direction: t.direction,
    amount: Number(t.amount),
    hasSettlement: t.launch_settlement_id != null,
    hasBankMovement: t.bank_movement_id != null,
    notes: t.notes ?? "",
  }));

  const columns: Column<Row>[] = [
    { key: "date", label: "Fecha", render: (r) => fmtDate(r.date) },
    { key: "project", label: "Proyecto", render: (r) => r.project },
    {
      key: "direction",
      label: "Dirección",
      render: (r) => <DirectionPill direction={r.direction} />,
    },
    {
      key: "amount",
      label: "Monto",
      align: "right",
      numeric: true,
      // Ver comentario en /movimientos: el signo comunica dirección, la pill
      // el color. `a_favor_cliente` es devengo positivo (Kingrow debe);
      // `transferido` es la salida que cancela ese devengo, se muestra con
      // signo menos porque reduce el saldo a favor.
      render: (r) =>
        r.direction === "transferido"
          ? fMoney(-r.amount)
          : fMoney(r.amount),
    },
    {
      key: "settlement",
      label: "Liquidación",
      render: (r) => (r.hasSettlement ? "Sí" : "—"),
    },
    {
      key: "bank",
      label: "Movim. bancario",
      render: (r) => (r.hasBankMovement ? "Sí" : "—"),
    },
    {
      key: "notes",
      label: "Notas",
      render: (r) =>
        r.notes ? (
          <span title={r.notes} style={ellipsis}>
            {r.notes}
          </span>
        ) : (
          "—"
        ),
    },
  ];

  function buildHref(overrides: {
    direction?: DirectionParam;
    range?: RangeParam;
  }): string {
    const nextDirection = overrides.direction ?? directionParam;
    const nextRange = overrides.range ?? rangeParam;
    const params = new URLSearchParams();
    if (nextDirection !== "todos") params.set("direction", nextDirection);
    if (nextRange !== "todo") params.set("range", nextRange);
    const qs = params.toString();
    return qs
      ? `/financiero/transferencias?${qs}`
      : "/financiero/transferencias";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconFin size={16} />}
        title="Transferencias a clientes"
        stats={[
          { l: "En la vista", v: fCount(totalCount) },
          { l: "A favor del cliente", v: fMoney(aFavor) },
          { l: "Transferido", v: fMoney(transferido) },
          { l: "Saldo Kingrow debe", v: fMoney(saldo) },
          {
            l: `Pendientes de transferir (${fCount(pendingCount)})`,
            v: fMoney(pendingTotal),
            c: pendingCount > 0 ? "#FFB800" : undefined,
          },
        ]}
      />

      <Panel title="Liquidaciones pendientes de transferir" pad={false}>
        <PendingPanel
          pending={pendingSettlements}
          banks={banksForDrawer}
        />
      </Panel>

      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <KgParamPills
            ariaLabel="Filtrar por dirección"
            options={DIRECTION_OPTIONS.map((o) => ({
              label: o.label,
              href: buildHref({ direction: o.value }),
              active: directionParam === o.value,
            }))}
          />
          <KgParamPills
            ariaLabel="Filtrar por período"
            options={RANGE_OPTIONS.map((o) => ({
              label: o.label,
              href: buildHref({ range: o.value }),
              active: rangeParam === o.value,
            }))}
          />
        </div>
        <a
          href={buildExportHref(directionParam, rangeParam)}
          className="kg-focus"
          style={{
            padding: "6px 14px",
            borderRadius: 999,
            background: "transparent",
            border: "1px solid var(--kg-border-subtle)",
            color: "var(--kg-text-2)",
            fontSize: 12,
            fontWeight: 700,
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
          }}
          title="Exportar la vista actual a Excel"
        >
          Exportar Excel
        </a>
      </div>

      <Panel title="Cuenta corriente con clientes externos" pad={false}>
        <KgDataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          totalCount={totalCount}
          emptyTitle="No hay transferencias registradas"
          emptyHint="Los devengos 'a favor del cliente' se generan automáticamente al cerrar una liquidación de un proyecto externo con saldo positivo (RPC close_launch_settlement). Rey Academy es proyecto propio — no genera transfer. Cuando se registre la transferencia real desde el módulo bancario, aparecerá con dirección 'transferido'."
        />
      </Panel>
    </div>
  );
}

const ellipsis: React.CSSProperties = {
  display: "inline-block",
  maxWidth: 320,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  verticalAlign: "middle",
};

function buildExportHref(direction: DirectionParam, range: RangeParam): string {
  const params = new URLSearchParams();
  if (direction !== "todos") params.set("direction", direction);
  if (range !== "todo") params.set("range", range);
  const qs = params.toString();
  return qs
    ? `/api/financiero/transferencias/export?${qs}`
    : "/api/financiero/transferencias/export";
}

function parseDirection(v: string | string[] | undefined): DirectionParam {
  if (typeof v !== "string") return "todos";
  const allowed: DirectionParam[] = [
    "todos",
    "a_favor_cliente",
    "transferido",
  ];
  return (allowed as string[]).includes(v)
    ? (v as DirectionParam)
    : "todos";
}
function parseRange(v: string | string[] | undefined): RangeParam {
  if (typeof v !== "string") return "todo";
  const allowed: RangeParam[] = ["todo", "mes-actual", "mes-anterior", "90d"];
  return (allowed as string[]).includes(v) ? (v as RangeParam) : "todo";
}
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function DirectionPill({
  direction,
}: {
  readonly direction: "a_favor_cliente" | "transferido";
}) {
  const isDevengo = direction === "a_favor_cliente";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        background: isDevengo
          ? "rgba(255,184,0,0.15)"
          : "rgba(0,208,132,0.15)",
        color: isDevengo ? "#FFB800" : "#00D084",
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: isDevengo ? "#FFB800" : "#00D084",
          display: "inline-block",
        }}
      />
      {isDevengo ? "A favor del cliente" : "Transferido"}
    </span>
  );
}
