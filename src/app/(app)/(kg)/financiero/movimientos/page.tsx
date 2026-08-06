import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconFin } from "@/components/kg/icons";
import { KgPaginator } from "@/components/kg/paginator";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { listBanks } from "@/lib/banks/list";
import { fCount, fMoney } from "@/lib/finance/format";
import { resolvePeriod, type Period } from "@/lib/finance/period";
import { createClient } from "@/lib/supabase/server";

import type { BankOption } from "./movement-form-drawer";
import {
  MovimientosView,
  type MovementRowData,
} from "./movimientos-view";

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
  readonly transaction_number: string | null;
  readonly created_at: string;
}

interface BankRow {
  readonly id: string;
  readonly name: string;
  readonly project_id: string | null;
  readonly active: boolean;
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

  let query = supabase
    .from("bank_movements")
    .select(
      "id, bank_id, kind, amount, occurred_at, description, transaction_number, created_at",
    )
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

  // Traemos TODOS los bancos (no solo los de los movimientos) para el
  // selector del drawer de "Nuevo movimiento". `listBanks()` post 0101
  // trae org-wide con RLS.
  const banks = (await listBanks()) as unknown as BankRow[];
  const bankById = new Map<string, BankRow>(banks.map((b) => [b.id, b]));

  // Nombre de proyectos que aparecen ligados a algún banco. Post 0101 el
  // project_id es NULL para todos, así que en la práctica esto queda vacío
  // — mostramos "—" en la columna. Se conserva la query por si algún banco
  // "escrow de proyecto" aparece en el futuro.
  const projectIds = Array.from(
    new Set(
      banks
        .map((b) => b.project_id)
        .filter((id): id is string => id != null),
    ),
  );
  const projectNameById = new Map<string, string>();
  if (projectIds.length > 0) {
    const { data } = await supabase
      .from("projects")
      .select("id, name")
      .in("id", projectIds);
    for (const p of (data ?? []) as ProjectNameRow[]) {
      projectNameById.set(p.id, p.name);
    }
  }

  const totalCount = movements.length;
  const paged = movements.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const cashIn = movements
    .filter((m) => m.kind === "in")
    .reduce((a, m) => a + Number(m.amount), 0);
  const cashOut = movements
    .filter((m) => m.kind === "out")
    .reduce((a, m) => a + Number(m.amount), 0);
  const net = cashIn - cashOut;

  const rows: MovementRowData[] = paged.map((m) => {
    const bank = bankById.get(m.bank_id);
    return {
      id: m.id,
      bankId: m.bank_id,
      bankName: bank?.name ?? "—",
      projectName: bank?.project_id
        ? projectNameById.get(bank.project_id) ?? "—"
        : "—",
      kind: m.kind,
      amount: Number(m.amount),
      occurredAt: m.occurred_at,
      description: m.description ?? "",
      transactionNumber: m.transaction_number,
    };
  });

  const banksForDrawer: BankOption[] = banks.map((b) => ({
    id: b.id,
    name: b.name,
    active: b.active,
  }));

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
        <MovimientosView
          rows={rows}
          totalCount={totalCount}
          banks={banksForDrawer}
          exportHref={buildExportHref(kindParam, rangeParam)}
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

function buildExportHref(kind: KindParam, range: RangeParam): string {
  const params = new URLSearchParams();
  if (kind !== "todos") params.set("kind", kind);
  if (range !== "todo") params.set("range", range);
  const qs = params.toString();
  return qs
    ? `/api/financiero/movimientos/export?${qs}`
    : "/api/financiero/movimientos/export";
}

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
