import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconFin } from "@/components/kg/icons";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { fCount, fMoney } from "@/lib/finance/format";
import { overlapsPeriodDate, resolvePeriod, type Period } from "@/lib/finance/period";
import { createClient } from "@/lib/supabase/server";

import {
  NominaView,
  type PayrollRowData,
} from "./nomina-view";
import type { UnconciledMovement } from "./link-payment-drawer";
import type { PersonOption } from "./payroll-form-drawer";

export const metadata: Metadata = { title: "Nómina · Financiero" };

// Payroll no tiene volumen alto — cargamos todo y filtramos en TS. Sin
// paginación por ahora: si crece a >200 filas se agrega igual que gastos.

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

interface PayrollDbRow {
  readonly id: string;
  readonly person_id: string;
  readonly period_start: string;
  readonly period_end: string;
  readonly base_salary: number;
  readonly total_amount: number;
  readonly currency: string | null;
  readonly extras: Record<string, number> | null;
  readonly due_date: string | null;
  readonly paid_at: string | null;
  readonly bank_movement_id: string | null;
  readonly notes: string | null;
}

interface PersonSalaryRow {
  readonly id: string;
  readonly full_name: string;
  readonly monthly_salary: number;
  readonly salary_currency: "ARS" | "USD";
  readonly active: boolean;
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
}

export default async function NominaPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const paidParam = parsePaid(sp.paid);
  const rangeParam = parseRange(sp.range);

  const period: Period | null =
    rangeParam === "todo" ? null : resolvePeriod({ range: rangeParam });

  const supabase = await createClient();

  // ─── Fetch base: payroll + people ────────────────────────────────────
  //
  // Payroll trae también `currency` y `bank_movement_id` (0066) — el drawer
  // de vincular pago los necesita para el warning de moneda y para saber si
  // la fila ya está vinculada.
  const [payrollRes, peopleRes] = await Promise.all([
    supabase
      .from("payroll")
      .select(
        "id, person_id, period_start, period_end, base_salary, total_amount, currency, extras, due_date, paid_at, bank_movement_id, notes",
      )
      .order("period_end", { ascending: false }),
    supabase
      .from("organization_people")
      .select("id, full_name, monthly_salary, salary_currency, active")
      .order("full_name", { ascending: true }),
  ]);

  const allRows = (payrollRes.data ?? []) as unknown as PayrollDbRow[];
  const allPeople = (peopleRes.data ?? []) as unknown as PersonSalaryRow[];
  const personById = new Map<string, string>(
    allPeople.map((p) => [p.id, p.full_name] as const),
  );
  const activePeopleForForm: PersonOption[] = allPeople
    .filter((p) => p.active)
    .map((p) => ({
      id: p.id,
      full_name: p.full_name,
      monthly_salary: Number(p.monthly_salary),
      salary_currency: p.salary_currency,
    }));

  // ─── Bank movements NO conciliados (para el drawer de vincular pago) ──
  //
  // "No conciliado" = no está vinculado como bank_movement_id de NINGUNA
  // liquidación de nómina. NO excluimos las movimientos linkeados a expenses
  // — 1 movimiento puede pagar 1 gasto + 1 sueldo (ej. una transferencia
  // grande que discrimina), y el schema lo permite (mismo criterio que la
  // pestaña de gastos).
  //
  // Piso de 12 meses igual que gastos — los pagos frescos son el 99% del uso.
  const twelveMonthsAgo = ymdMonthsAgo(12);
  const [allMovementsRes, linkedIdsRes] = await Promise.all([
    supabase
      .from("bank_movements")
      .select("id, bank_id, kind, amount, occurred_at, description")
      .eq("kind", "out")
      .gte("occurred_at", twelveMonthsAgo)
      .order("occurred_at", { ascending: false }),
    supabase
      .from("payroll")
      .select("bank_movement_id")
      .not("bank_movement_id", "is", null),
  ]);

  const allMovements =
    (allMovementsRes.data ?? []) as unknown as BankMovementDbRow[];
  const linkedBankIds = new Set<string>();
  for (const r of (linkedIdsRes.data ?? []) as {
    bank_movement_id: string | null;
  }[]) {
    if (r.bank_movement_id) linkedBankIds.add(r.bank_movement_id);
  }
  const unconciled = allMovements.filter((m) => !linkedBankIds.has(m.id));

  const bankIds = Array.from(new Set(unconciled.map((m) => m.bank_id)));
  const banksRes =
    bankIds.length > 0
      ? await supabase.from("banks").select("id, name").in("id", bankIds)
      : { data: [] as BankRow[] };
  const bankNameById = new Map<string, string>(
    ((banksRes.data ?? []) as BankRow[]).map((b) => [b.id, b.name]),
  );

  const unconciledForDrawer: UnconciledMovement[] = unconciled.map((m) => ({
    id: m.id,
    amount: Number(m.amount),
    occurredAt: m.occurred_at,
    // El schema actual de bank_movements NO tiene columna currency; el saldo
    // se lleva en la moneda nativa del `bank` (banks.currency, 0101/0103).
    // Para el score, tratamos la moneda del movimiento como null → matchea
    // como "sin info". Cuando el modelo evolucione a movimiento con moneda
    // propia, esto se llena desde ahí.
    currency: null,
    kind: m.kind,
    bankName: bankNameById.get(m.bank_id) ?? "—",
    description: m.description ?? "",
  }));

  // ─── Filtrado en TS por los pills de estado/período ──────────────────
  const filtered = allRows.filter((p) => {
    if (paidParam === "pagado" && p.paid_at == null) return false;
    if (paidParam === "impago" && p.paid_at != null) return false;
    if (period && !overlapsPeriodDate(p.period_start, p.period_end, period))
      return false;
    return true;
  });

  const totalCount = filtered.length;
  const totalAmount = filtered.reduce((a, p) => a + Number(p.total_amount), 0);
  const impagoAmount = filtered
    .filter((p) => p.paid_at == null)
    .reduce((a, p) => a + Number(p.total_amount), 0);

  const rows: PayrollRowData[] = filtered.map((p) => ({
    id: p.id,
    personId: p.person_id,
    personName: personById.get(p.person_id) ?? "—",
    periodStart: p.period_start,
    periodEnd: p.period_end,
    baseSalary: Number(p.base_salary),
    totalAmount: Number(p.total_amount),
    currency: p.currency === "USD" ? "USD" : "ARS",
    extras: normalizeExtras(p.extras),
    dueDate: p.due_date,
    notes: p.notes,
    paidAt: p.paid_at,
    bankMovementId: p.bank_movement_id,
  }));

  function buildHref(overrides: {
    paid?: PaidParam;
    range?: RangeParam;
  }): string {
    const nextPaid = overrides.paid ?? paidParam;
    const nextRange = overrides.range ?? rangeParam;
    const params = new URLSearchParams();
    if (nextPaid !== "todos") params.set("paid", nextPaid);
    if (nextRange !== "todo") params.set("range", nextRange);
    const qs = params.toString();
    return qs ? `/financiero/nomina?${qs}` : "/financiero/nomina";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconFin size={16} />}
        title="Nómina"
        stats={[
          { l: "Liquidaciones en la vista", v: fCount(totalCount) },
          { l: "Total", v: fMoney(totalAmount) },
          { l: "Impagas", v: fMoney(impagoAmount) },
          {
            l: "Movimientos sin conciliar",
            v: fCount(unconciled.length),
            c: unconciled.length > 0 ? "#FFB800" : undefined,
          },
        ]}
      />

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <KgParamPills
          ariaLabel="Filtrar por estado de pago"
          options={PAID_OPTIONS.map((o) => ({
            label: o.label,
            href: buildHref({ paid: o.value }),
            active: paidParam === o.value,
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

      <Panel title="Nómina" pad={false}>
        <NominaView
          rows={rows}
          totalCount={totalCount}
          people={activePeopleForForm}
          unconciledMovements={unconciledForDrawer}
        />
      </Panel>
    </div>
  );
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
function ymdMonthsAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Postgrest devuelve `extras` como `Record<string, unknown> | null`. Filtramos
 * a números finitos para no romper el drawer si el jsonb quedó con basura
 * (ej. un valor viejo `null` o string).
 */
function normalizeExtras(
  extras: Record<string, number> | null,
): Record<string, number> {
  if (extras == null) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(extras)) {
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}
