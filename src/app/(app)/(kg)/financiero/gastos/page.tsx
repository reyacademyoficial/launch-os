import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { KgDataTable, type Column } from "@/components/kg/data-table";
import { IconFin } from "@/components/kg/icons";
import { KgPaginator } from "@/components/kg/paginator";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { fCount, fMoney } from "@/lib/finance/format";
import { resolvePeriod, type Period } from "@/lib/finance/period";
import type { FinanceExpenseRow } from "@/lib/finance/types";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Gastos · Financiero" };

const PAGE_SIZE = 50;

type PaidParam = "todos" | "pagado" | "impago";
type RangeParam = "todo" | "mes-actual" | "mes-anterior" | "90d";

const PAID_OPTIONS: ReadonlyArray<{ value: PaidParam; label: string }> = [
  { value: "todos", label: "Todos" },
  { value: "pagado", label: "Pagados" },
  { value: "impago", label: "Impagos" },
];
const RANGE_OPTIONS: ReadonlyArray<{ value: RangeParam; label: string }> = [
  { value: "todo", label: "Todo" },
  { value: "mes-actual", label: "Mes actual" },
  { value: "mes-anterior", label: "Mes anterior" },
  { value: "90d", label: "90 días" },
];

interface ExpenseDbRow extends FinanceExpenseRow {
  readonly id: string;
  readonly description: string;
  readonly supplier_id: string | null;
  readonly bank_movement_id: string | null;
}

interface SupplierRow {
  readonly id: string;
  readonly name: string;
}

export default async function GastosPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const paidParam = parsePaid(sp.paid);
  const rangeParam = parseRange(sp.range);
  const page = parsePage(sp.page);

  const period: Period | null =
    rangeParam === "todo" ? null : resolvePeriod({ range: rangeParam });

  const supabase = await createClient();

  let query = supabase
    .from("expenses")
    .select(
      "id, description, category, supplier_id, amount_gross, tax_amount, expense_date, due_date, paid_at, bank_movement_id",
    )
    .order("expense_date", { ascending: false });

  if (paidParam === "pagado") query = query.not("paid_at", "is", null);
  else if (paidParam === "impago") query = query.is("paid_at", null);
  if (period) {
    query = query
      .gte("expense_date", period.fromYmd)
      .lte("expense_date", period.toYmd);
  }

  const expensesRes = await query;
  const expenses = (expensesRes.data ?? []) as unknown as ExpenseDbRow[];

  const supplierIds = Array.from(
    new Set(
      expenses.map((e) => e.supplier_id).filter((id): id is string => id != null),
    ),
  );
  const suppliersRes =
    supplierIds.length > 0
      ? await supabase
          .from("suppliers")
          .select("id, name")
          .in("id", supplierIds)
      : { data: [] as SupplierRow[] };
  const supplierNameById = new Map<string, string>(
    ((suppliersRes.data ?? []) as SupplierRow[]).map((s) => [s.id, s.name]),
  );

  const totalCount = expenses.length;
  const paged = expenses.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const totalNet = expenses.reduce(
    (a, e) => a + (e.amount_gross - e.tax_amount),
    0,
  );
  const impagoNet = expenses
    .filter((e) => e.paid_at == null)
    .reduce((a, e) => a + (e.amount_gross - e.tax_amount), 0);

  interface Row {
    readonly id: string;
    readonly expenseDate: string;
    readonly description: string;
    readonly category: string;
    readonly supplier: string;
    readonly amountGross: number;
    readonly taxAmount: number;
    readonly amountNet: number;
    readonly dueDate: string | null;
    readonly paidAt: string | null;
  }
  const rows: Row[] = paged.map((e) => ({
    id: e.id,
    expenseDate: e.expense_date,
    description: e.description,
    category: e.category ?? "—",
    supplier: e.supplier_id
      ? supplierNameById.get(e.supplier_id) ?? "—"
      : "—",
    amountGross: Number(e.amount_gross),
    taxAmount: Number(e.tax_amount),
    amountNet: Number(e.amount_gross) - Number(e.tax_amount),
    dueDate: e.due_date,
    paidAt: e.paid_at,
  }));

  const columns: Column<Row>[] = [
    { key: "date", label: "Fecha", render: (r) => fmtDate(r.expenseDate) },
    {
      key: "description",
      label: "Descripción",
      render: (r) => (
        <span title={r.description} style={ellipsis}>
          {r.description}
        </span>
      ),
    },
    { key: "category", label: "Categoría", render: (r) => r.category },
    { key: "supplier", label: "Proveedor", render: (r) => r.supplier },
    {
      key: "gross",
      label: "Bruto",
      align: "right",
      numeric: true,
      render: (r) => fMoney(r.amountGross),
    },
    {
      key: "iva",
      label: "IVA",
      align: "right",
      numeric: true,
      render: (r) => fMoney(r.taxAmount),
    },
    {
      key: "net",
      label: "Neto",
      align: "right",
      numeric: true,
      render: (r) => fMoney(r.amountNet),
    },
    {
      key: "due",
      label: "Vence",
      render: (r) => (r.dueDate ? fmtDate(r.dueDate) : "—"),
    },
    {
      key: "paid",
      label: "Estado",
      render: (r) => <PaidPill paidAt={r.paidAt} />,
    },
  ];

  function buildHref(overrides: {
    paid?: PaidParam;
    range?: RangeParam;
    page?: number;
  }): string {
    const nextPaid = overrides.paid ?? paidParam;
    const nextRange = overrides.range ?? rangeParam;
    const nextPage = overrides.page ?? page;
    const params = new URLSearchParams();
    if (nextPaid !== "todos") params.set("paid", nextPaid);
    if (nextRange !== "todo") params.set("range", nextRange);
    if (nextPage > 1) params.set("page", String(nextPage));
    const qs = params.toString();
    return qs ? `/financiero/gastos?${qs}` : "/financiero/gastos";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconFin size={16} />}
        title="Gastos"
        stats={[
          { l: "Total en la vista", v: fCount(totalCount) },
          { l: "Neto acumulado", v: fMoney(totalNet) },
          { l: "Pendientes de pago (neto)", v: fMoney(impagoNet) },
        ]}
      />

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <KgParamPills
          ariaLabel="Filtrar por estado de pago"
          options={PAID_OPTIONS.map((o) => ({
            label: o.label,
            href: buildHref({ paid: o.value, page: 1 }),
            active: paidParam === o.value,
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

      <Panel title="Gastos" pad={false}>
        <KgDataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          totalCount={totalCount}
          emptyTitle="No hay gastos cargados"
          emptyHint="Sin gastos cargados, los KPIs Gastos operativos, Utilidad neta y Burn del dashboard financiero quedan en cero. Los movimientos bancarios de salida (pestaña Movimientos) NO alimentan estos KPIs — cargar el gasto acá es lo que los hace visibles."
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
  maxWidth: 320,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  verticalAlign: "middle",
};

function parsePaid(v: string | string[] | undefined): PaidParam {
  if (typeof v !== "string") return "todos";
  const allowed: PaidParam[] = ["todos", "pagado", "impago"];
  return (allowed as string[]).includes(v) ? (v as PaidParam) : "todos";
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

function PaidPill({ paidAt }: { readonly paidAt: string | null }) {
  const paid = paidAt != null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        background: paid ? "rgba(0,208,132,0.15)" : "rgba(138,138,153,0.15)",
        color: paid ? "#00D084" : "var(--kg-text-2)",
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: paid ? "#00D084" : "#8A8A99",
          display: "inline-block",
        }}
      />
      {paid ? `Pagado ${fmtDate(paidAt!)}` : "Impago"}
    </span>
  );
}
