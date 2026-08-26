import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconFin } from "@/components/kg/icons";
import { KgPageFilters } from "@/components/kg/page-menu";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { computeBankBalances } from "@/lib/banks/balance";
import { listBanks, listBankMovements } from "@/lib/banks/list";
import {
  computeBankFees,
  type BankFeeRow,
  type FeeOrigin,
} from "@/lib/finance/bank-fees";
import { fCount } from "@/lib/finance/format";
import {
  inPeriodDate,
  resolvePeriod,
  type Period,
} from "@/lib/finance/period";
import {
  fmtArs,
  fmtUsd,
  loadLatestOrgFxRate,
  loadOrgFxRatesByMonth,
} from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

import { BankFeesPanel } from "./bank-fees-panel";
import { BancosView, type BankRowData } from "./bancos-view";
import { NewBankButton } from "./new-bank-button";

import { RangePills, type PresetOption } from "../range-pills";

export const metadata: Metadata = { title: "Bancos · Financiero" };

// Bancos son estructura, no eventos — sin filtro de período para el listado
// principal (activos/inactivos). El panel de comisiones bancarias SÍ usa
// período (default mes-actual); comparten los mismos query params ?range /
// ?from / ?to que el resto de listados financieros.
type ActiveParam = "activos" | "inactivos" | "todos";

const ACTIVE_OPTIONS: ReadonlyArray<{ value: ActiveParam; label: string }> = [
  { value: "activos", label: "Activos" },
  { value: "inactivos", label: "Dados de baja" },
  { value: "todos", label: "Todos" },
];

const FEES_RANGE_PRESETS: readonly PresetOption[] = [
  { value: "mes-actual", label: "Mes actual" },
  { value: "mes-anterior", label: "Mes anterior" },
  { value: "90d", label: "90 días" },
];

export default async function BancosPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const activeParam = parseActive(sp.state);
  const rangeParam = typeof sp.range === "string" ? sp.range : null;
  const fromParam = typeof sp.from === "string" ? sp.from : null;
  const toParam = typeof sp.to === "string" ? sp.to : null;
  // Default: mes-actual. El panel de comisiones necesita SIEMPRE un período
  // (para "todos" el mes-actual es la ventana más útil por defecto).
  const feesPeriod: Period = resolvePeriod({
    range: rangeParam ?? "mes-actual",
    from: fromParam,
    to: toParam,
  });
  const feesIsCustom =
    fromParam != null && toParam != null && rangeParam == null;

  const supabase = await createClient();

  // ─── Fetch en paralelo ─────────────────────────────────────────────────
  //
  // Post refactor 2026-08: los cobros (`payments`) NO alimentan el balance
  // del banco. La única fuente que mueve el saldo son los `bank_movements`.
  // Los cobros por método siguen visibles en /financiero/metodos-pago como
  // métrica de trazabilidad.
  const [banks, movements, latestFx, orgFxByMonth] = await Promise.all([
    listBanks(),
    listBankMovements(),
    loadLatestOrgFxRate(supabase),
    loadOrgFxRatesByMonth(supabase),
  ]);

  const filteredBanks =
    activeParam === "activos"
      ? banks.filter((b) => b.active)
      : activeParam === "inactivos"
        ? banks.filter((b) => !b.active)
        : banks;

  const balances = computeBankBalances(filteredBanks, movements);

  const rows: BankRowData[] = filteredBanks.map((b) => {
    const bal = balances.get(b.id);
    const total = bal?.total ?? Number(b.opening_balance);
    const totalUsd =
      b.currency === "USD"
        ? total
        : latestFx
          ? total / latestFx.rate
          : null;
    return {
      id: b.id,
      name: b.name,
      currency: b.currency,
      openingBalance: bal?.opening ?? Number(b.opening_balance),
      movementsIn: bal?.movementsIn ?? 0,
      movementsOut: bal?.movementsOut ?? 0,
      total,
      totalUsd,
      active: b.active,
    };
  });

  const totalCount = rows.length;
  // Sumamos separado por moneda: sumar ARS + USD en la misma numérica no tiene
  // sentido físico. El total consolidado en USD sale en el dashboard financiero
  // aplicando la conversión con las tasas del proyecto (task #9).
  const activeRows = rows.filter((r) => r.active);
  const totalActivoARS = activeRows
    .filter((r) => r.currency === "ARS")
    .reduce((acc, r) => acc + r.total, 0);
  const totalActivoUSD = activeRows
    .filter((r) => r.currency === "USD")
    .reduce((acc, r) => acc + r.total, 0);
  // Total consolidado en USD: bancos USD + ARS convertidos con la última tasa.
  const totalConsolidadoUsd = latestFx
    ? totalActivoUSD + totalActivoARS / latestFx.rate
    : null;

  // ═════════════════════════════════════════════════════════════════════════
  // Panel de comisiones bancarias — datos del período (feesPeriod).
  //
  // Fetch de los 4 bridges filtrados por role='comision' Y ligados a
  // bank_movements dentro del período. Para cada uno, resolvemos el monto
  // principal del ítem padre para poder mostrar "%" contra el pago
  // (fees / principalTotal por origen).
  //
  // Conversión a USD: mismo criterio que /financiero — bancos ARS convierten
  // vía la tasa org del mes de occurred_at (fallback: latestFx). USD nativo
  // pasa directo. Sin tasa disponible, el monto ARS se toma como-está para
  // no romper el KPI (mismo comportamiento que el dashboard).
  // ═════════════════════════════════════════════════════════════════════════
  const orgLatestRate =
    latestFx && latestFx.rate > 0 ? latestFx.rate : null;
  const bankById = new Map<string, (typeof banks)[number]>();
  for (const b of banks) bankById.set(b.id, b);

  function resolveOrgRateForMonth(ymd: string): number | null {
    const rateMonth = orgFxByMonth.get(ymd.slice(0, 7));
    if (rateMonth != null && rateMonth > 0) return rateMonth;
    return orgLatestRate;
  }

  function movementAmountToUsd(
    amount: number,
    bankId: string,
    occurredAt: string,
  ): number {
    const currency = bankById.get(bankId)?.currency ?? "ARS";
    if (currency === "USD") return amount;
    const rate = resolveOrgRateForMonth(occurredAt);
    return rate != null ? amount / rate : amount;
  }

  // Cash flow del período (todos los movimientos del rango, no filtrado por
  // conciliación). Alimenta el ratio "fees / cash flow" del KPI hero.
  const movementsInPeriod = movements.filter((m) =>
    inPeriodDate(m.occurred_at, feesPeriod),
  );
  let cashInTotal = 0;
  let cashOutTotal = 0;
  for (const m of movementsInPeriod) {
    const usd = movementAmountToUsd(
      Number(m.amount),
      m.bank_id,
      m.occurred_at,
    );
    if (m.kind === "in") cashInTotal += usd;
    else cashOutTotal += usd;
  }

  // Set de ids de bank_movements del período — solo esos pueden estar
  // linkeados como comisión de este rango.
  const movementIdsInPeriod = movementsInPeriod.map((m) => m.id);
  const movementByIdInPeriod = new Map<
    string,
    (typeof movementsInPeriod)[number]
  >();
  for (const m of movementsInPeriod) movementByIdInPeriod.set(m.id, m);

  interface FeeBridgeInvoice {
    readonly bank_movement_id: string;
    readonly invoice_id: string;
    readonly invoices: {
      invoice_number: string | null;
      amount_gross: number;
      tax_amount: number;
      currency: "ARS" | "USD";
      paid_at: string | null;
      issue_date: string;
      project_id: string | null;
    } | null;
  }
  interface FeeBridgeExpense {
    readonly bank_movement_id: string;
    readonly expense_id: string;
    readonly expenses: {
      description: string | null;
      amount_gross: number;
      tax_amount: number;
      currency: "ARS" | "USD";
      expense_date: string;
    } | null;
  }
  interface FeeBridgePayroll {
    readonly bank_movement_id: string;
    readonly payroll_id: string;
    readonly payroll: {
      id: string;
      total_amount: number;
      currency: "ARS" | "USD" | null;
      period_start: string;
      period_end: string;
      person_id: string;
    } | null;
  }
  interface FeeBridgeTransfer {
    readonly bank_movement_id: string;
    readonly client_transfer_id: string;
    readonly client_transfers: {
      id: string;
      amount: number;
      date: string;
      project_id: string;
    } | null;
  }

  const [invFeesRes, expFeesRes, payFeesRes, ctFeesRes] =
    movementIdsInPeriod.length > 0
      ? await Promise.all([
          supabase
            .from("invoice_bank_movements")
            .select(
              "bank_movement_id, invoice_id, invoices!inner(invoice_number, amount_gross, tax_amount, currency, paid_at, issue_date, project_id)",
            )
            .eq("role", "comision")
            .in("bank_movement_id", movementIdsInPeriod),
          supabase
            .from("expense_bank_movements")
            .select(
              "bank_movement_id, expense_id, expenses!inner(description, amount_gross, tax_amount, currency, expense_date)",
            )
            .eq("role", "comision")
            .in("bank_movement_id", movementIdsInPeriod),
          supabase
            .from("payroll_bank_movements")
            .select(
              "bank_movement_id, payroll_id, payroll!inner(id, total_amount, currency, period_start, period_end, person_id)",
            )
            .eq("role", "comision")
            .in("bank_movement_id", movementIdsInPeriod),
          supabase
            .from("client_transfer_bank_movements")
            .select(
              "bank_movement_id, client_transfer_id, client_transfers!inner(id, amount, date, project_id)",
            )
            .eq("role", "comision")
            .in("bank_movement_id", movementIdsInPeriod),
        ])
      : [
          { data: [] as FeeBridgeInvoice[] },
          { data: [] as FeeBridgeExpense[] },
          { data: [] as FeeBridgePayroll[] },
          { data: [] as FeeBridgeTransfer[] },
        ];

  // Resolver nombres/labels para top comisiones + drawer del panel.
  const personIdsForFees = new Set<string>();
  for (const r of (payFeesRes.data ?? []) as unknown as FeeBridgePayroll[]) {
    if (r.payroll) personIdsForFees.add(r.payroll.person_id);
  }
  const projectIdsForFees = new Set<string>();
  for (const r of (ctFeesRes.data ?? []) as unknown as FeeBridgeTransfer[]) {
    if (r.client_transfers) projectIdsForFees.add(r.client_transfers.project_id);
  }
  const [peopleRes, projectsRes] = await Promise.all([
    personIdsForFees.size > 0
      ? supabase
          .from("organization_people")
          .select("id, full_name")
          .in("id", Array.from(personIdsForFees))
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string }> }),
    projectIdsForFees.size > 0
      ? supabase
          .from("projects")
          .select("id, name")
          .in("id", Array.from(projectIdsForFees))
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
  ]);
  const personNameById = new Map<string, string>();
  for (const p of (peopleRes.data ?? []) as Array<{
    id: string;
    full_name: string;
  }>) {
    personNameById.set(p.id, p.full_name);
  }
  const projectNameByIdFees = new Map<string, string>();
  for (const p of (projectsRes.data ?? []) as Array<{
    id: string;
    name: string;
  }>) {
    projectNameByIdFees.set(p.id, p.name);
  }

  function principalToUsd(
    amount: number,
    currency: "ARS" | "USD" | null,
    anchorYmd: string,
  ): number {
    if (currency === "USD") return amount;
    const rate = resolveOrgRateForMonth(anchorYmd);
    return rate != null ? amount / rate : amount;
  }

  function feeRowFromMovement(
    mvId: string,
    origin: FeeOrigin,
    itemId: string,
    itemLabel: string,
    principalAmount: number | null,
  ): BankFeeRow | null {
    const mv = movementByIdInPeriod.get(mvId);
    if (!mv) return null;
    const bank = bankById.get(mv.bank_id);
    return {
      movementId: mv.id,
      bankId: mv.bank_id,
      bankName: bank?.name ?? "—",
      currency: bank?.currency ?? "ARS",
      amount: movementAmountToUsd(
        Number(mv.amount),
        mv.bank_id,
        mv.occurred_at,
      ),
      occurredAt: mv.occurred_at,
      origin,
      itemId,
      itemLabel,
      principalAmount,
    };
  }

  const feeRows: BankFeeRow[] = [];
  for (const r of (invFeesRes.data ?? []) as unknown as FeeBridgeInvoice[]) {
    const inv = r.invoices;
    const principalNet =
      inv != null
        ? principalToUsd(
            Number(inv.amount_gross) - Number(inv.tax_amount),
            inv.currency,
            inv.paid_at ?? inv.issue_date,
          )
        : null;
    const label = inv?.invoice_number ?? "Factura s/n";
    const row = feeRowFromMovement(
      r.bank_movement_id,
      "invoice",
      r.invoice_id,
      label,
      principalNet,
    );
    if (row) feeRows.push(row);
  }
  for (const r of (expFeesRes.data ?? []) as unknown as FeeBridgeExpense[]) {
    const exp = r.expenses;
    const principalNet =
      exp != null
        ? principalToUsd(
            Number(exp.amount_gross) - Number(exp.tax_amount),
            exp.currency,
            exp.expense_date,
          )
        : null;
    const label = exp?.description ?? "Gasto s/descripción";
    const row = feeRowFromMovement(
      r.bank_movement_id,
      "expense",
      r.expense_id,
      label,
      principalNet,
    );
    if (row) feeRows.push(row);
  }
  for (const r of (payFeesRes.data ?? []) as unknown as FeeBridgePayroll[]) {
    const pay = r.payroll;
    const principal =
      pay != null
        ? principalToUsd(
            Number(pay.total_amount),
            pay.currency ?? "ARS",
            pay.period_start,
          )
        : null;
    const label = pay
      ? `${personNameById.get(pay.person_id) ?? "—"} · ${pay.period_start.slice(0, 7)}`
      : "Sueldo";
    const row = feeRowFromMovement(
      r.bank_movement_id,
      "payroll",
      r.payroll_id,
      label,
      principal,
    );
    if (row) feeRows.push(row);
  }
  for (const r of (ctFeesRes.data ?? []) as unknown as FeeBridgeTransfer[]) {
    const ct = r.client_transfers;
    // client_transfers no tienen currency propia — misma convención que
    // /financiero: usar la tasa org del mes de `date`.
    const principal =
      ct != null ? principalToUsd(Number(ct.amount), "ARS", ct.date) : null;
    const label = ct
      ? `Transferencia a ${projectNameByIdFees.get(ct.project_id) ?? "cliente"}`
      : "Transferencia";
    const row = feeRowFromMovement(
      r.bank_movement_id,
      "transfer",
      r.client_transfer_id,
      label,
      principal,
    );
    if (row) feeRows.push(row);
  }

  const bankFees = computeBankFees({
    fees: feeRows,
    cashInTotal,
    cashOutTotal,
  });

  function buildHref(state: ActiveParam): string {
    if (state === "activos") return "/financiero/bancos";
    return `/financiero/bancos?state=${state}`;
  }

  return (
    <div className="flex flex-col gap-5">
      <ContextBar
        icon={<IconFin size={16} />}
        title="Bancos"
        stats={[
          { l: "En la vista", v: fCount(totalCount) },
          { l: "Saldo ARS (activos)", v: fmtArs(totalActivoARS) },
          { l: "Saldo USD (activos)", v: fmtUsd(totalActivoUSD) },
          ...(totalConsolidadoUsd !== null
            ? [
                {
                  l: `Total USD (tasa ${latestFx!.month})`,
                  v: fmtUsd(totalConsolidadoUsd),
                },
              ]
            : []),
        ]}
      />

      <KgPageFilters activeCount={activeParam !== "activos" ? 1 : 0}>
        <div style={{ display: "flex", gap: 10 }}>
          <KgParamPills
            ariaLabel="Filtrar por estado"
            options={ACTIVE_OPTIONS.map((o) => ({
              label: o.label,
              href: buildHref(o.value),
              active: activeParam === o.value,
            }))}
          />
        </div>
      </KgPageFilters>

      <Panel
        title="Bancos de Kingrow"
        pad={false}
        actions={<NewBankButton />}
      >
        <BancosView rows={rows} totalCount={totalCount} />
      </Panel>

      {/* ─── Panel de comisiones bancarias ─────────────────────────────── */}
      <KgPageFilters
        activeCount={
          feesIsCustom || (rangeParam != null && rangeParam !== "mes-actual")
            ? 1
            : 0
        }
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            marginTop: 8,
          }}
        >
          <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
            Comisiones del período:{" "}
            <strong style={{ color: "var(--kg-text-1)" }}>
              {feesPeriod.label}
            </strong>
          </div>
          <RangePills
            presets={FEES_RANGE_PRESETS}
            activePreset={feesIsCustom ? null : (rangeParam as "mes-actual" | "mes-anterior" | "90d" | null) ?? "mes-actual"}
            activeFrom={feesPeriod.fromYmd}
            activeTo={feesPeriod.toYmd}
            baseHref="/financiero/bancos"
          />
        </div>
      </KgPageFilters>
      <BankFeesPanel data={bankFees} periodLabel={feesPeriod.label} />
    </div>
  );
}

function parseActive(v: string | string[] | undefined): ActiveParam {
  if (typeof v !== "string") return "activos";
  const allowed: ActiveParam[] = ["activos", "inactivos", "todos"];
  return (allowed as string[]).includes(v) ? (v as ActiveParam) : "activos";
}
