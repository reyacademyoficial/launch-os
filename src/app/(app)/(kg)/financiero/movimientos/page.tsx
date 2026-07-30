import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { KgDataTable, type Column } from "@/components/kg/data-table";
import { IconFin } from "@/components/kg/icons";
import { KgPaginator } from "@/components/kg/paginator";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { fCount, fMoney } from "@/lib/finance/format";
import { resolvePeriod, type Period } from "@/lib/finance/period";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Movimientos · Financiero" };

const PAGE_SIZE = 50;

type KindParam = "todos" | "in" | "out";
type RangeParam = "todo" | "mes-actual" | "mes-anterior" | "90d";

const KIND_OPTIONS: ReadonlyArray<{ value: KindParam; label: string }> = [
  { value: "todos", label: "Todos" },
  { value: "in", label: "Entradas" },
  { value: "out", label: "Salidas" },
];
const RANGE_OPTIONS: ReadonlyArray<{ value: RangeParam; label: string }> = [
  { value: "todo", label: "Todo" },
  { value: "mes-actual", label: "Mes actual" },
  { value: "mes-anterior", label: "Mes anterior" },
  { value: "90d", label: "90 días" },
];

interface MovementDbRow {
  readonly id: string;
  readonly bank_id: string;
  readonly kind: "in" | "out";
  readonly amount: number;
  readonly occurred_at: string;
  readonly description: string | null;
  readonly created_at: string;
}

interface BankRow {
  readonly id: string;
  readonly name: string;
  readonly project_id: string;
}

interface ProjectNameRow {
  readonly id: string;
  readonly name: string;
}

export default async function MovimientosPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const kindParam = parseKind(sp.kind);
  const rangeParam = parseRange(sp.range);
  const page = parsePage(sp.page);

  const period: Period | null =
    rangeParam === "todo" ? null : resolvePeriod({ range: rangeParam });

  const supabase = await createClient();

  // Fetch: bank_movements es project-scope pero superadmin ve todo por RLS.
  // Traemos todo el histórico filtrado y paginamos en TS (44 filas hoy;
  // llega a miles → migrar a .range() cuando pique el volumen).
  let query = supabase
    .from("bank_movements")
    .select("id, bank_id, kind, amount, occurred_at, description, created_at")
    .order("occurred_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (kindParam !== "todos") query = query.eq("kind", kindParam);
  if (period) {
    query = query
      .gte("occurred_at", period.fromYmd)
      .lte("occurred_at", period.toYmd);
  }

  const movRes = await query;
  const movements = (movRes.data ?? []) as unknown as MovementDbRow[];

  // Resolver banco → proyecto en dos queries encadenadas (menos overhead
  // que un join anidado con `banks(project_id, name, projects(name))` y más
  // fácil de leer).
  const bankIds = Array.from(new Set(movements.map((m) => m.bank_id)));
  const banksRes =
    bankIds.length > 0
      ? await supabase.from("banks").select("id, name, project_id").in("id", bankIds)
      : { data: [] as BankRow[] };
  const banks = (banksRes.data ?? []) as BankRow[];
  const bankById = new Map<string, BankRow>(banks.map((b) => [b.id, b]));

  const projectIds = Array.from(new Set(banks.map((b) => b.project_id)));
  const projectsRes =
    projectIds.length > 0
      ? await supabase.from("projects").select("id, name").in("id", projectIds)
      : { data: [] as ProjectNameRow[] };
  const projectNameById = new Map<string, string>(
    ((projectsRes.data ?? []) as ProjectNameRow[]).map((p) => [p.id, p.name]),
  );

  const totalCount = movements.length;
  const paged = movements.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const cashIn = movements
    .filter((m) => m.kind === "in")
    .reduce((a, m) => a + Number(m.amount), 0);
  const cashOut = movements
    .filter((m) => m.kind === "out")
    .reduce((a, m) => a + Number(m.amount), 0);
  const net = cashIn - cashOut;

  interface Row {
    readonly id: string;
    readonly occurredAt: string;
    readonly bank: string;
    readonly project: string;
    readonly kind: "in" | "out";
    readonly amount: number;
    readonly description: string;
  }
  const rows: Row[] = paged.map((m) => {
    const bank = bankById.get(m.bank_id);
    return {
      id: m.id,
      occurredAt: m.occurred_at,
      bank: bank?.name ?? "—",
      project: bank ? projectNameById.get(bank.project_id) ?? "—" : "—",
      kind: m.kind,
      amount: Number(m.amount),
      description: m.description ?? "",
    };
  });

  const columns: Column<Row>[] = [
    { key: "date", label: "Fecha", render: (r) => fmtDate(r.occurredAt) },
    { key: "project", label: "Proyecto", render: (r) => r.project },
    { key: "bank", label: "Banco", render: (r) => r.bank },
    {
      key: "kind",
      label: "Tipo",
      render: (r) => <KindPill kind={r.kind} />,
    },
    {
      key: "amount",
      label: "Monto",
      align: "right",
      numeric: true,
      // Salidas con signo negativo — el color se comunica por la pill de
      // "Tipo", no por pintar el número. Regla del design system KG.
      render: (r) => (r.kind === "out" ? fMoney(-r.amount) : fMoney(r.amount)),
    },
    {
      key: "description",
      label: "Descripción",
      render: (r) =>
        r.description ? (
          <span title={r.description} style={ellipsis}>
            {r.description}
          </span>
        ) : (
          "—"
        ),
    },
  ];

  function buildHref(overrides: {
    kind?: KindParam;
    range?: RangeParam;
    page?: number;
  }): string {
    const nextKind = overrides.kind ?? kindParam;
    const nextRange = overrides.range ?? rangeParam;
    const nextPage = overrides.page ?? page;
    const params = new URLSearchParams();
    if (nextKind !== "todos") params.set("kind", nextKind);
    if (nextRange !== "todo") params.set("range", nextRange);
    if (nextPage > 1) params.set("page", String(nextPage));
    const qs = params.toString();
    return qs ? `/financiero/movimientos?${qs}` : "/financiero/movimientos";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconFin size={16} />}
        title="Movimientos bancarios"
        stats={[
          { l: "Total en la vista", v: fCount(totalCount) },
          { l: "Entradas", v: fMoney(cashIn) },
          { l: "Salidas", v: fMoney(cashOut) },
          { l: "Neto", v: fMoney(net) },
        ]}
      />

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <KgParamPills
          ariaLabel="Filtrar por tipo"
          options={KIND_OPTIONS.map((o) => ({
            label: o.label,
            href: buildHref({ kind: o.value, page: 1 }),
            active: kindParam === o.value,
          }))}
        />
        <KgParamPills
          ariaLabel="Filtrar por período"
          options={RANGE_OPTIONS.map((o) => ({
            label: o.label,
            href: buildHref({ range: o.value, page: 1 }),
            active: rangeParam === o.value,
          }))}
        />
      </div>

      <Panel title="Ingresos y egresos bancarios" pad={false}>
        <KgDataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          totalCount={totalCount}
          emptyTitle="No hay movimientos bancarios cargados"
          emptyHint="Los movimientos alimentan el KPI Flujo de caja del dashboard. Cobros de ventas NO se duplican acá — viven en payments; esta tabla es para ingresos/egresos manuales (gastos, retiros, transferencias, ajustes)."
        />
        <KgPaginator
          page={page}
          pageSize={PAGE_SIZE}
          totalCount={totalCount}
          hrefFor={(n) => buildHref({ page: n })}
        />
      </Panel>
    </div>
  );
}

const ellipsis: React.CSSProperties = {
  display: "inline-block",
  maxWidth: 360,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  verticalAlign: "middle",
};

function parseKind(v: string | string[] | undefined): KindParam {
  if (typeof v !== "string") return "todos";
  const allowed: KindParam[] = ["todos", "in", "out"];
  return (allowed as string[]).includes(v) ? (v as KindParam) : "todos";
}
function parseRange(v: string | string[] | undefined): RangeParam {
  if (typeof v !== "string") return "todo";
  const allowed: RangeParam[] = ["todo", "mes-actual", "mes-anterior", "90d"];
  return (allowed as string[]).includes(v) ? (v as RangeParam) : "todo";
}
function parsePage(v: string | string[] | undefined): number {
  if (typeof v !== "string") return 1;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
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

function KindPill({ kind }: { readonly kind: "in" | "out" }) {
  const positive = kind === "in";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        background: positive
          ? "rgba(0,208,132,0.15)"
          : "rgba(239,68,68,0.15)",
        color: positive ? "#00D084" : "#EF4444",
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: positive ? "#00D084" : "#EF4444",
          display: "inline-block",
        }}
      />
      {positive ? "Entrada" : "Salida"}
    </span>
  );
}
