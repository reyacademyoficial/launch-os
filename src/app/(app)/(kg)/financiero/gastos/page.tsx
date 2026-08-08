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

import { RangePills, type PresetOption } from "../range-pills";

import type { UnconciledMovement } from "./link-payment-drawer";
import { GastosView, type ExpenseRowData } from "./gastos-view";

export const metadata: Metadata = { title: "Gastos · Financiero" };

const PAGE_SIZE = 50;

type PaidParam = "todos" | "pagado" | "impago";
type RangeParam = "todo" | "mes-actual" | "mes-anterior" | "90d" | "custom";

const PAID_OPTIONS: ReadonlyArray<{ value: PaidParam; label: string }> = [
  { value: "todos", label: "Todos" },
  { value: "pagado", label: "Pagados" },
  { value: "impago", label: "Impagos" },
];
const RANGE_PRESETS: readonly PresetOption[] = [
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
  readonly transaction_number: string | null;
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
  readonly currency: "ARS" | "USD";
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
  const fromParam = parseYmd(sp.from);
  const toParam = parseYmd(sp.to);
  const page = parsePage(sp.page);

  const isCustom = fromParam != null && toParam != null;
  const effectiveRange: RangeParam = isCustom ? "custom" : rangeParam;
  const period: Period | null =
    effectiveRange === "todo"
      ? null
      : isCustom
        ? resolvePeriod({ from: fromParam, to: toParam })
        : resolvePeriod({ range: effectiveRange });

  const supabase = await createClient();

  // ─── Expenses filtrados por el estado + rango elegidos ────────────────
  let query = supabase
    .from("expenses")
    .select(
      "id, description, category, supplier_id, amount_gross, tax_amount, currency, expense_date, due_date, paid_at, bank_movement_id, notes, transaction_number",
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
  const expenseIdsPaged = expenses.map((e) => e.id);
  const [allMovementsRes, allExpensesBankIdsRes, bridgeAllRes, bridgePagedRes] =
    await Promise.all([
      supabase
        .from("bank_movements")
        .select("id, bank_id, kind, amount, occurred_at, description")
        .gte("occurred_at", twelveMonthsAgo)
        .order("occurred_at", { ascending: false }),
      supabase
        .from("expenses")
        .select("bank_movement_id")
        .not("bank_movement_id", "is", null),
      // Todos los links del bridge — para detectar movimientos ya linkeados
      // a algún gasto (aunque sea comisión / otro) y sacarlos de la lista
      // "no conciliados".
      supabase.from("expense_bank_movements").select("bank_movement_id"),
      // Bridge sólo de los gastos paginados — para popular linkedMovements
      // en cada ExpenseRowData (evita traer el mundo entero).
      expenseIdsPaged.length > 0
        ? supabase
            .from("expense_bank_movements")
            .select(
              "expense_id, bank_movement_id, role, bank_movements!inner(amount, kind, occurred_at, description, bank_id)",
            )
            .in("expense_id", expenseIdsPaged)
        : Promise.resolve({ data: [] }),
    ]);

  const allMovements =
    (allMovementsRes.data ?? []) as unknown as BankMovementDbRow[];
  const linkedBankIds = new Set<string>();
  for (const r of (allExpensesBankIdsRes.data ?? []) as {
    bank_movement_id: string | null;
  }[]) {
    if (r.bank_movement_id) linkedBankIds.add(r.bank_movement_id);
  }
  for (const r of (bridgeAllRes.data ?? []) as { bank_movement_id: string }[]) {
    linkedBankIds.add(r.bank_movement_id);
  }
  const unconciled = allMovements.filter((m) => !linkedBankIds.has(m.id));

  // Bridge de los gastos paginados agrupado por expense_id.
  interface BridgePagedRow {
    readonly expense_id: string;
    readonly bank_movement_id: string;
    readonly role: "principal" | "comision" | "otro";
    readonly bank_movements: {
      readonly amount: number;
      readonly kind: "in" | "out";
      readonly occurred_at: string;
      readonly description: string | null;
      readonly bank_id: string;
    } | null;
  }
  const bridgeRows = (bridgePagedRes.data ?? []) as unknown as BridgePagedRow[];
  const bridgeBankIds = Array.from(
    new Set(
      bridgeRows
        .map((b) => b.bank_movements?.bank_id)
        .filter((id): id is string => !!id),
    ),
  );

  // ─── Resolver nombres de suppliers, banks, projects ──────────────────
  const supplierIds = Array.from(
    new Set(
      expenses.map((e) => e.supplier_id).filter((id): id is string => id != null),
    ),
  );
  const bankIds = Array.from(
    new Set([...unconciled.map((m) => m.bank_id), ...bridgeBankIds]),
  );

  const [suppliersRes, banksRes] = await Promise.all([
    supplierIds.length > 0
      ? supabase.from("suppliers").select("id, name").in("id", supplierIds)
      : Promise.resolve({ data: [] as SupplierRow[] }),
    bankIds.length > 0
      ? supabase
          .from("banks")
          .select("id, name, project_id, currency")
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

  // ─── Movimientos linkeados por gasto (paso 6) ────────────────────────
  const linkedMovementsByExpenseId = new Map<
    string,
    Array<{
      movementId: string;
      role: "principal" | "comision" | "otro";
      amount: number;
      kind: "in" | "out";
      occurredAt: string;
      description: string | null;
      bankName: string;
    }>
  >();
  for (const b of bridgeRows) {
    if (!b.bank_movements) continue;
    const shaped = {
      movementId: b.bank_movement_id,
      role: b.role,
      amount: Number(b.bank_movements.amount),
      kind: b.bank_movements.kind,
      occurredAt: b.bank_movements.occurred_at,
      description: b.bank_movements.description,
      bankName: bankById.get(b.bank_movements.bank_id)?.name ?? "—",
    };
    const arr = linkedMovementsByExpenseId.get(b.expense_id);
    if (arr) arr.push(shaped);
    else linkedMovementsByExpenseId.set(b.expense_id, [shaped]);
  }

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
    transactionNumber: e.transaction_number,
    linkedMovements: linkedMovementsByExpenseId.get(e.id) ?? [],
  }));

  const unconciledForDrawer: UnconciledMovement[] = unconciled.map((m) => {
    const bank = bankById.get(m.bank_id);
    return {
      id: m.id,
      amount: Number(m.amount),
      occurredAt: m.occurred_at,
      // Moneda heredada de banks.currency (0103). Antes hardcodeábamos "ARS"
      // y eso empujaba matches falsos: un gasto USD contra un movimiento de
      // banco USD quedaba como currencyMismatch=true y no aparecía primero.
      currency: bank?.currency ?? "ARS",
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
    page?: number;
  }): string {
    const nextPaid = overrides.paid ?? paidParam;
    const nextPage = overrides.page ?? page;
    const params = new URLSearchParams();
    if (nextPaid !== "todos") params.set("paid", nextPaid);
    if (isCustom && fromParam && toParam) {
      params.set("from", fromParam);
      params.set("to", toParam);
    } else if (rangeParam !== "todo") {
      params.set("range", rangeParam);
    }
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
        <RangePills
          presets={RANGE_PRESETS}
          activePreset={isCustom ? null : rangeParam === "custom" ? null : rangeParam}
          activeFrom={period?.fromYmd ?? null}
          activeTo={period?.toYmd ?? null}
          baseHref="/financiero/gastos"
        />
      </div>

      <Panel title="Gastos" pad={false}>
        <GastosView
          rows={rows}
          totalCount={totalCount}
          unconciledMovements={unconciledForDrawer}
          exportHref={buildExportHref(paidParam, rangeParam, fromParam, toParam)}
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

function buildExportHref(
  paid: PaidParam,
  range: RangeParam,
  from: string | null,
  to: string | null,
): string {
  const params = new URLSearchParams();
  if (paid !== "todos") params.set("paid", paid);
  if (from && to) {
    params.set("from", from);
    params.set("to", to);
  } else if (range !== "todo") {
    params.set("range", range);
  }
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
  const allowed: RangeParam[] = [
    "todo",
    "mes-actual",
    "mes-anterior",
    "90d",
    "custom",
  ];
  return (allowed as string[]).includes(v) ? (v as RangeParam) : "todo";
}
function parseYmd(v: string | string[] | undefined): string | null {
  if (typeof v !== "string") return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
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
