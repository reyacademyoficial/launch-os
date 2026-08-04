import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconFin } from "@/components/kg/icons";
import { KgPaginator } from "@/components/kg/paginator";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { fCount, fMoney } from "@/lib/finance/format";
import { resolvePeriod, type Period } from "@/lib/finance/period";
import type { FinanceExpenseRow } from "@/lib/finance/types";
import { createClient } from "@/lib/supabase/server";

import type { UnconciledMovement } from "./link-payment-drawer";
import { GastosView, type ExpenseRowData } from "./gastos-view";

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
  readonly currency: string | null;
  readonly notes: string | null;
  readonly due_date: string | null;
}

interface SupplierRow {
  readonly id: string;
  readonly name: string;
}

interface BankMovementDbRow {
  readonly id: string;
  readonly bank_id: string;
  readonly kind: "in" | "out";
  readonly amount: number;
  readonly occurred_at: string;
  readonly description: string | null;
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

  // ─── Expenses filtrados por el estado + rango elegidos ────────────────
  let query = supabase
    .from("expenses")
    .select(
      "id, description, category, supplier_id, amount_gross, tax_amount, currency, expense_date, due_date, paid_at, bank_movement_id, notes",
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

  // ─── Bank movements NO conciliados (para el drawer de vincular pago + contador) ─
  // "No conciliado" = no aparece como bank_movement_id de NINGÚN expense.
  // Se resuelve con una query aparte + set difference. postgrest-js no
  // tiene NOT EXISTS elegante — dos queries es la forma pragmática.
  //
  // El fetch de bank_movements se limita a los últimos 12 meses para no
  // traer historia entera cuando eventualmente crezca. Cuando el humano
  // vincule un pago viejo (>12m) el drawer no lo va a mostrar — decisión
  // pragmática: los pagos frescos son el 99% del uso.
  const twelveMonthsAgo = ymdMonthsAgo(12);
  const [allMovementsRes, allExpensesBankIdsRes] = await Promise.all([
    supabase
      .from("bank_movements")
      .select("id, bank_id, kind, amount, occurred_at, description")
      .gte("occurred_at", twelveMonthsAgo)
      .order("occurred_at", { ascending: false }),
    supabase
      .from("expenses")
      .select("bank_movement_id")
      .not("bank_movement_id", "is", null),
  ]);

  const allMovements =
    (allMovementsRes.data ?? []) as unknown as BankMovementDbRow[];
  const linkedBankIds = new Set<string>();
  for (const r of (allExpensesBankIdsRes.data ?? []) as {
    bank_movement_id: string | null;
  }[]) {
    if (r.bank_movement_id) linkedBankIds.add(r.bank_movement_id);
  }
  const unconciled = allMovements.filter((m) => !linkedBankIds.has(m.id));

  // ─── Resolver nombres de suppliers, banks, projects ──────────────────
  const supplierIds = Array.from(
    new Set(
      expenses.map((e) => e.supplier_id).filter((id): id is string => id != null),
    ),
  );
  const bankIds = Array.from(new Set(unconciled.map((m) => m.bank_id)));

  const [suppliersRes, banksRes] = await Promise.all([
    supplierIds.length > 0
      ? supabase.from("suppliers").select("id, name").in("id", supplierIds)
      : Promise.resolve({ data: [] as SupplierRow[] }),
    bankIds.length > 0
      ? supabase
          .from("banks")
          .select("id, name, project_id")
          .in("id", bankIds)
      : Promise.resolve({ data: [] as BankRow[] }),
  ]);

  const supplierNameById = new Map<string, string>(
    ((suppliersRes.data ?? []) as SupplierRow[]).map((s) => [s.id, s.name]),
  );
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

  const totalCount = expenses.length;
  const paged = expenses.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const totalNet = expenses.reduce(
    (a, e) => a + (e.amount_gross - e.tax_amount),
    0,
  );
  const impagoNet = expenses
    .filter((e) => e.paid_at == null)
    .reduce((a, e) => a + (e.amount_gross - e.tax_amount), 0);

  // ─── Serializar filas para el cliente ────────────────────────────────
  const rows: ExpenseRowData[] = paged.map((e) => ({
    id: e.id,
    expenseDate: e.expense_date,
    description: e.description,
    category: e.category ?? null,
    supplier: e.supplier_id
      ? supplierNameById.get(e.supplier_id) ?? "—"
      : "—",
    amountGross: Number(e.amount_gross),
    taxAmount: Number(e.tax_amount),
    amountNet: Number(e.amount_gross) - Number(e.tax_amount),
    currency: e.currency ?? "ARS",
    dueDate: e.due_date,
    paidAt: e.paid_at,
    bankMovementId: e.bank_movement_id,
    notes: e.notes,
  }));

  const unconciledForDrawer: UnconciledMovement[] = unconciled.map((m) => {
    const bank = bankById.get(m.bank_id);
    return {
      id: m.id,
      amount: Number(m.amount),
      occurredAt: m.occurred_at,
      currency: "ARS",
      kind: m.kind,
      bankName: bank?.name ?? "—",
      projectName: bank
        ? projectNameById.get(bank.project_id) ?? "—"
        : "—",
      description: m.description ?? "",
    };
  });

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
          { l: "En la vista", v: fCount(totalCount) },
          { l: "Neto acumulado", v: fMoney(totalNet) },
          { l: "Pendientes de pago (neto)", v: fMoney(impagoNet) },
          {
            l: "Movimientos sin conciliar",
            v: fCount(unconciled.length),
            // Warning tone si hay muchos — señal de brecha activa.
            c: unconciled.length > 0 ? "#FFB800" : undefined,
          },
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
        <GastosView
          rows={rows}
          totalCount={totalCount}
          unconciledMovements={unconciledForDrawer}
          exportHref={buildExportHref(paidParam, rangeParam)}
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

function buildExportHref(paid: PaidParam, range: RangeParam): string {
  const params = new URLSearchParams();
  if (paid !== "todos") params.set("paid", paid);
  if (range !== "todo") params.set("range", range);
  const qs = params.toString();
  return qs
    ? `/api/financiero/gastos/export?${qs}`
    : "/api/financiero/gastos/export";
}

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
function ymdMonthsAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
