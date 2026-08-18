import type { Metadata } from "next";

import { computeBankBalances } from "@/lib/banks/balance";
import { listBanks, listBankMovements } from "@/lib/banks/list";
import {
  clientBalance,
  computeAccountsPayable,
  computeAccountsReceivable,
  computeBurnRate,
  computeCashFlow,
  computeGroupInvoicing,
  computeInvoiceDataQuality,
  computeNetWorth,
  computeProfit,
  sumExpensesNet,
  sumPayrollTotal,
} from "@/lib/finance/kpis";
import { bucketOfCategory } from "@/lib/finance/expense-categories";
import { fPct } from "@/lib/finance/format";
import { loadLatestOrgFxRate, loadOrgFxRatesByMonth } from "@/lib/money";
import type { Ownership } from "@/lib/finance/invoice-classification";
import {
  inPeriodDate,
  inPeriodTs,
  lastClosedMonths,
  lastMonths,
  overlapsPeriodDate,
  resolveFetchFloor,
  resolvePeriod,
} from "@/lib/finance/period";
import { computeRevenue, type OwnershipResolver } from "@/lib/finance/revenue";
import { classifyRunway } from "@/lib/finance/runway";
import type {
  FinanceAssetRow,
  FinanceBankMovementRow,
  FinanceClientTransferRow,
  FinanceExpenseRow,
  FinanceInvoiceRow,
  FinanceLaunchSettlementRow,
  FinanceLiabilityRow,
  FinancePayrollRow,
} from "@/lib/finance/types";
import { createClient } from "@/lib/supabase/server";

import {
  FinancieroDashboard,
  type FinancieroDashboardData,
  type LaunchSettlementRow,
} from "./dashboard";

export const metadata: Metadata = { title: "Financiero" };

// ═══════════════════════════════════════════════════════════════════════════
// Row shapes con los campos adicionales que la page necesita para armar
// panels/detalles (más allá de lo que consumen los selectores puros). Los
// selectores solo leen el subset declarado en `finance/types.ts`.
// ═══════════════════════════════════════════════════════════════════════════
type SettlementRowWithMeta = FinanceLaunchSettlementRow & {
  readonly launch_id: string;
  readonly project_id: string;
  readonly collected_total: number;
  readonly owed_to_client: number;
};
type ExpenseRowWithMeta = FinanceExpenseRow;
type LaunchFxRow = {
  readonly id: string;
  readonly name: string | null;
  readonly ars_per_usd: number | null;
};
type ProjectOwnershipRow = {
  readonly id: string;
  readonly ownership: "propia" | "externa";
};
type ProjectFxMonthlyRow = {
  readonly project_id: string;
  readonly month: string;
  readonly ars_per_usd: number;
};
type PayoutRow = {
  readonly launch_id: string;
  readonly amount: number;
  readonly paid_at: string;
};

export default async function FinancieroPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const rangeParam = typeof sp.range === "string" ? sp.range : null;
  const fromParam = typeof sp.from === "string" ? sp.from : null;
  const toParam = typeof sp.to === "string" ? sp.to : null;
  const period = resolvePeriod({
    range: rangeParam,
    from: fromParam,
    to: toParam,
  });

  const supabase = await createClient();

  // Piso del fetch para las dos tablas que alimentan el sparkline de 12 meses:
  // `.gte()` a 13 meses atrás (calendario KG_TZ) para no traer historia entera.
  // El `resolveFetchFloor` blinda contra que el período pedido empiece antes
  // del piso — hoy los 3 presets caen dentro, pero un preset más largo o un
  // `?from=` ad-hoc por URL bajarían el piso automáticamente.
  const fetchFloorYmd = resolveFetchFloor(period.fromYmd, 13);

  // Ventana FIJA de burn: 3 meses calendario cerrados en KG_TZ (no depende
  // del ?range). Se calcula antes del fetch porque los payouts necesitan
  // cubrir tanto el período del dashboard como esta ventana para alimentar
  // burn + directCosts sin dos queries.
  const burnWindow = lastClosedMonths(3);
  const payoutsFetchFrom =
    burnWindow.fromYmd < period.fromYmd ? burnWindow.fromYmd : period.fromYmd;

  // ───────────── Fetch: RLS org-scope filtra por `can_edit_organization`.
  // Un rol cliente ni siquiera llega acá (el gate está en `(app)/layout.tsx`);
  // aunque llegara, la RLS le devuelve arrays vacíos. Las escrituras están
  // fuera del alcance de 6b — no importamos ni ejecutamos server actions.
  const [
    settlementsRes,
    invoicesRes,
    expensesRes,
    payrollRes,
    assetsRes,
    liabilitiesRes,
    clientTransfersRes,
    bankMovementsRes,
    payoutsRes,
    banksList,
    allBankMovements,
    latestFx,
    orgFxByMonth,
  ] = await Promise.all([
    supabase
      .from("launch_settlements")
      .select(
        "kingrow_retained, collected_total, owed_to_client, status, closed_at, created_at, launch_id, project_id",
      )
      .gte("closed_at", fetchFloorYmd),
    // Invoices: OR entre "paid_at NULL" (pendientes → alimentan AR sin filtro
    // de fecha) y "paid_at >= piso" (cobradas dentro de la ventana). Un
    // `.gte("paid_at", ...)` a secas descartaría las pendientes y rompería AR.
    // `project_id` + `launch_id` (0064 + 0098) alimentan la clasificación de
    // 6b-rev — sin ellos no se puede decidir qué factura es ingreso propio.
    supabase
      .from("invoices")
      .select(
        "project_id, launch_id, amount_gross, tax_amount, currency, status, paid_at, due_date, issue_date",
      )
      .or(`paid_at.is.null,paid_at.gte.${fetchFloorYmd}`),
    supabase
      .from("expenses")
      .select(
        "amount_gross, tax_amount, currency, category, paid_at, due_date, expense_date, project_id",
      ),
    supabase
      .from("payroll")
      .select(
        "total_amount, currency, paid_at, due_date, period_start, period_end",
      ),
    supabase.from("assets").select("amount, currency, active"),
    supabase.from("liabilities").select("amount, currency, active, settled_at"),
    supabase.from("client_transfers").select("amount, direction, date"),
    // `bank_id` para poder resolver la moneda del movimiento (heredada de
    // banks.currency) al convertir a USD el cash flow.
    supabase
      .from("bank_movements")
      .select("bank_id, amount, kind, occurred_at"),
    // Comisiones pagadas al equipo por lanzamiento — atribuibles como costo
    // directo del launch (junto con publicidad). `launch_id NOT NULL` en la
    // tabla; la moneda se deriva de `launches.ars_per_usd`. La ventana cubre
    // el período del dashboard Y la burnWindow (min de ambos) para que el
    // burn del runway también los sume sin duplicar el query.
    supabase
      .from("team_member_payouts")
      .select("launch_id, amount, paid_at")
      .gte("paid_at", payoutsFetchFrom)
      .lte("paid_at", period.toYmd),
    // Fuente del KPI "Bancos" (Fila 1): saldo consolidado en USD sobre todos
    // los bancos activos. `computeBankBalances` reconstruye el saldo runtime
    // desde opening_balance + bank_movements (kind in/out). Los cobros
    // (`payments`) NO alimentan el balance — se concilian por movimiento vía
    // Nº de transacción y links factura ↔ movimiento.
    listBanks(),
    listBankMovements(),
    loadLatestOrgFxRate(supabase),
    // Tasas org por mes — para convertir gastos y nómina (sin `project_id`)
    // usando la tasa del mes de devengo en vez de una tasa global.
    loadOrgFxRatesByMonth(supabase),
  ]);

  // Cast en el borde — postgrest-js colapsa a `never` sobre el Database
  // generado (patrón documentado en memoria). Los shapes son los subsets
  // que los selectores esperan; columnas extra se ignoran silenciosamente.
  const settlements = (settlementsRes.data ?? []) as SettlementRowWithMeta[];
  const invoices = (invoicesRes.data ?? []) as FinanceInvoiceRow[];
  const expenses = (expensesRes.data ?? []) as ExpenseRowWithMeta[];
  const payroll = (payrollRes.data ?? []) as FinancePayrollRow[];
  const assets = (assetsRes.data ?? []) as FinanceAssetRow[];
  const liabilities = (liabilitiesRes.data ?? []) as FinanceLiabilityRow[];
  const clientTransfers = (clientTransfersRes.data ??
    []) as FinanceClientTransferRow[];
  const bankMovements =
    (bankMovementsRes.data ?? []) as (FinanceBankMovementRow & {
      bank_id: string;
    })[];
  const payouts = (payoutsRes.data ?? []) as PayoutRow[];

  // Lanzamientos: nombre (panel de liquidaciones) + `ars_per_usd` para
  // convertir `kingrow_retained` de settlements y `amount` de payouts a
  // USD. Rate null = launch operado en USD nativo (no convertir); rate > 0
  // = launch en ARS y se divide por la tasa. Si RLS de `launches` no deja
  // leer, caemos a launch_id truncado y sin conversión — no rompe el
  // dashboard.
  const launchIdSet = new Set<string>();
  for (const s of settlements) launchIdSet.add(s.launch_id);
  for (const p of payouts) launchIdSet.add(p.launch_id);
  const launchIds = Array.from(launchIdSet);
  const launchById = new Map<string, LaunchFxRow>();
  const launchNameById = new Map<string, string>();
  if (launchIds.length > 0) {
    const launchesRes = await supabase
      .from("launches")
      .select("id, name, ars_per_usd")
      .in("id", launchIds);
    const launchRows = (launchesRes.data ?? []) as LaunchFxRow[];
    for (const l of launchRows) {
      launchById.set(l.id, l);
      launchNameById.set(l.id, l.name ?? `Lanzamiento ${l.id.slice(0, 6)}`);
    }
  }

  // Ownership de los projects referenciados por invoices Y settlements. El
  // mapa alimenta al selector del período, a las 12 iteraciones del
  // sparkline, Y al filtro que descarta settlements de propias (nueva
  // regla: propias van por percibido vía invoices, no por liquidación).
  // Sin pooling, computeRevenue haría 12 queries idénticas y las
  // inicializaciones del clasificador se volverían pesadas sin motivo.
  const projectIdsInInvoices = Array.from(
    new Set(
      invoices
        .map((i) => i.project_id)
        .filter((pid): pid is string => pid != null),
    ),
  );
  const projectIdsForOwnership = new Set<string>(projectIdsInInvoices);
  for (const s of settlements) projectIdsForOwnership.add(s.project_id);
  const ownershipByProjectId = new Map<string, Ownership>();
  if (projectIdsForOwnership.size > 0) {
    const projectsRes = await supabase
      .from("projects")
      .select("id, ownership")
      .in("id", Array.from(projectIdsForOwnership));
    const projectRows = (projectsRes.data ?? []) as ProjectOwnershipRow[];
    for (const row of projectRows) {
      ownershipByProjectId.set(row.id, row.ownership);
    }
  }
  // Si un project_id de la factura no aparece en el mapa (borrado, RLS,
  // race), el resolver devuelve null y el clasificador lo trata como
  // third-party (nunca inflar el ingreso).
  const resolveOwnership: OwnershipResolver = (projectId) =>
    projectId == null ? null : ownershipByProjectId.get(projectId) ?? null;

  // ─── FX para consolidar el ingreso en USD ────────────────────────────
  // Tasa mensual por proyecto para invoices en ARS sin launch (kingrow-income
  // + third-party). Match por (project_id, mes de paid_at). Fallback: tasa
  // org más reciente (`latestFx`). Si tampoco hay tasa, el monto ARS se toma
  // como-está — no es ideal pero coincide con el comportamiento previo
  // (mejor mostrar algo que romper el KPI).
  const fxByProjectMonth = new Map<string, number>();
  if (projectIdsInInvoices.length > 0) {
    const fxRes = await supabase
      .from("project_fx_rates")
      .select("project_id, month, ars_per_usd")
      .in("project_id", projectIdsInInvoices);
    const fxRows = (fxRes.data ?? []) as ProjectFxMonthlyRow[];
    for (const r of fxRows) {
      // `month` viene YYYY-MM-DD (primer día del mes por CHECK 0103).
      fxByProjectMonth.set(`${r.project_id}:${r.month.slice(0, 7)}`, r.ars_per_usd);
    }
  }
  const orgLatestRate =
    latestFx && latestFx.rate > 0 ? latestFx.rate : null;

  // Conversión settlement → USD. Regla: launch.ars_per_usd null = USD nativo
  // (retention ya está en USD, no convertir). Si el launch no está en el mapa
  // (RLS o borrado), tampoco convierte.
  function settlementToUsd(amount: number, launchId: string): number {
    const rate = launchById.get(launchId)?.ars_per_usd ?? null;
    if (rate == null || rate <= 0) return amount;
    return amount / rate;
  }

  // Conversión invoice → USD. USD nativo pasa directo. ARS busca tasa por
  // (project, mes de paid_at); fallback a la tasa org más reciente. Si no
  // hay tasa ni fallback, devuelve el monto crudo.
  function invoiceToUsd(amount: number, i: FinanceInvoiceRow): number {
    if (i.currency === "USD") return amount;
    const anchor = i.paid_at ?? i.issue_date;
    const monthKey = anchor.slice(0, 7);
    const pid = i.project_id;
    const rate = pid != null ? fxByProjectMonth.get(`${pid}:${monthKey}`) : undefined;
    if (rate != null && rate > 0) return amount / rate;
    if (orgLatestRate != null) return amount / orgLatestRate;
    return amount;
  }

  // Tasa org por mes con fallback a la más reciente. Uso: para egresos
  // org-scope (expenses, payroll) que no tienen `project_id`. Buscamos por
  // el mes de devengo (expense_date / period_start); si ese mes no tiene
  // tasa, caemos a la última tasa cargada.
  function resolveOrgRateForMonth(ymd: string): number | null {
    const rateMonth = orgFxByMonth.get(ymd.slice(0, 7));
    if (rateMonth != null && rateMonth > 0) return rateMonth;
    return orgLatestRate;
  }

  function expenseAmountToUsd(amount: number, e: FinanceExpenseRow): number {
    if (e.currency === "USD") return amount;
    const rate = resolveOrgRateForMonth(e.expense_date);
    return rate != null ? amount / rate : amount;
  }

  function payrollAmountToUsd(amount: number, p: FinancePayrollRow): number {
    if (p.currency === "USD") return amount;
    // Ancla en period_start — el mes contable del pago. Si no hay tasa
    // para ese mes cae a la más reciente disponible.
    const rate = resolveOrgRateForMonth(p.period_start);
    return rate != null ? amount / rate : amount;
  }

  function payoutAmountToUsd(amount: number, launchId: string): number {
    const rate = launchById.get(launchId)?.ars_per_usd ?? null;
    if (rate == null || rate <= 0) return amount;
    return amount / rate;
  }

  // Currency de bank_movements = currency del banco (0103). Movimientos
  // suman al cash flow — cada uno se convierte según su banco.
  const bankCurrencyById = new Map<string, "ARS" | "USD">();
  for (const b of banksList) bankCurrencyById.set(b.id, b.currency);

  function movementToUsd(m: FinanceBankMovementRow & { bank_id: string }): number {
    const currency = bankCurrencyById.get(m.bank_id) ?? "ARS";
    if (currency === "USD") return m.amount;
    const rate = resolveOrgRateForMonth(m.occurred_at);
    return rate != null ? m.amount / rate : m.amount;
  }

  // Client transfers no tienen currency propia. Convención: usar la tasa
  // org del mes de `date` (mismo criterio que expenses/payroll — todo lo
  // org-scope sin dueño de moneda usa la tasa mensual). Si originalmente
  // vino de un launch settlement (launch_settlement_id no null), la tasa
  // del launch sería más precisa; para eso habría que cargar settlements
  // + launches. Aproximación aceptable con la tasa org.
  function transferToUsd(amount: number, dateYmd: string): number {
    const rate = resolveOrgRateForMonth(dateYmd);
    return rate != null ? amount / rate : amount;
  }

  function assetToUsd(a: FinanceAssetRow): number {
    if (a.currency === "USD") return a.amount;
    // Assets no tienen fecha propia — usamos la tasa org más reciente.
    if (orgLatestRate != null) return a.amount / orgLatestRate;
    return a.amount;
  }

  function liabilityToUsd(l: FinanceLiabilityRow): number {
    if (l.currency === "USD") return l.amount;
    if (orgLatestRate != null) return l.amount / orgLatestRate;
    return l.amount;
  }

  // Arrays convertidas para todo cálculo de ingreso (KPI principal + sparkline).
  // El resto de KPIs (AR, AP, group volume, P&L) siguen leyendo los arrays
  // nativos — fix pendiente cuando se acuerde.
  //
  // Settlements: descarto las de projects propias. Para propias, el ingreso
  // ya suma vía invoices cobradas (nueva regla percibido). Si dejara la
  // liquidación posterior también sumar, contaría dos veces.
  const settlementsForRevenue: SettlementRowWithMeta[] = settlements
    .filter((s) => ownershipByProjectId.get(s.project_id) !== "propia")
    .map((s) => ({
      ...s,
      kingrow_retained: settlementToUsd(s.kingrow_retained, s.launch_id),
    }));
  const invoicesForRevenue: FinanceInvoiceRow[] = invoices.map((i) => ({
    ...i,
    amount_gross: invoiceToUsd(i.amount_gross, i),
    tax_amount: invoiceToUsd(i.tax_amount, i),
  }));

  // Egresos convertidos a USD para P&L. Preservamos las mismas rows para
  // que los filtros/selectores existentes sigan corriendo (fecha, category,
  // paid_at); solo los montos cambian.
  const expensesUsd: ExpenseRowWithMeta[] = expenses.map((e) => ({
    ...e,
    amount_gross: expenseAmountToUsd(e.amount_gross, e),
    tax_amount: expenseAmountToUsd(e.tax_amount, e),
  }));
  const payrollUsd: FinancePayrollRow[] = payroll.map((p) => ({
    ...p,
    total_amount: payrollAmountToUsd(p.total_amount, p),
  }));

  // ═════════════════════════════════════════════════════════════════════════
  // Filtrado por período. Los selectores no filtran por fecha (regla del
  // módulo); el caller elige la función por TIPO de columna:
  //   - `closed_at` de settlements es TIMESTAMPTZ → inPeriodTs (calendario AR)
  //   - todo el resto (paid_at, expense_date, period_*, occurred_at, date)
  //     son DATE → inPeriodDate / overlapsPeriodDate (slice-safe)
  // El sparkline replica esa misma decisión row-a-row más abajo.
  // ═════════════════════════════════════════════════════════════════════════
  const settlementsInPeriod = settlements.filter((s) =>
    inPeriodTs(s.closed_at, period),
  );
  const invoicesRevenueInPeriod = invoices.filter((i) =>
    inPeriodDate(i.paid_at, period),
  );
  // Versiones USD-convertidas del mismo filtro — sólo para revenue.
  const settlementsInPeriodUsd = settlementsForRevenue.filter((s) =>
    inPeriodTs(s.closed_at, period),
  );
  const invoicesRevenueInPeriodUsd = invoicesForRevenue.filter((i) =>
    inPeriodDate(i.paid_at, period),
  );
  const expensesInPeriod = expenses.filter((e) =>
    inPeriodDate(e.expense_date, period),
  );
  const payrollInPeriod = payroll.filter((p) =>
    overlapsPeriodDate(p.period_start, p.period_end, period),
  );
  // Versiones USD para P&L (netProfit + plParts + expenseCategories).
  const expensesInPeriodUsd = expensesUsd.filter((e) =>
    inPeriodDate(e.expense_date, period),
  );
  const payrollInPeriodUsd = payrollUsd.filter((p) =>
    overlapsPeriodDate(p.period_start, p.period_end, period),
  );
  const bankMovementsInPeriod = bankMovements.filter((m) =>
    inPeriodDate(m.occurred_at, period),
  );
  const clientTransfersInPeriod = clientTransfers.filter((t) =>
    inPeriodDate(t.date, period),
  );
  // Nota: `clientTransfersUsd` (para AR/AP/patrimonio) se calcula abajo,
  // después de definir el helper. Este `InPeriod` se usa solo para el
  // StatRow "clientBalance" — lo convertimos ahí también.

  // ═════════════════════════════════════════════════════════════════════════
  // KPIs — todos vienen de selectores puros.
  // ═════════════════════════════════════════════════════════════════════════
  const revenue = computeRevenue({
    settlements: settlementsInPeriodUsd,
    invoices: invoicesRevenueInPeriodUsd,
    resolveOwnership,
  });

  // Volumen del grupo: total de facturas cobradas en el período de TODAS las
  // empresas. KPI de contexto que NUNCA se suma al ingreso ni al P&L.
  // Convertido a USD para ser consistente con el ingreso.
  const groupInvoicing = computeGroupInvoicing(invoicesRevenueInPeriodUsd);

  // Calidad de dato: contadores sobre TODAS las facturas no anuladas de la
  // ventana traída (no solo las cobradas). Dos contadores separados porque
  // se arreglan de formas distintas (asignar project vs vincular launch).
  const invoiceDataQuality = computeInvoiceDataQuality(invoices);

  // ─── P&L en USD ─────────────────────────────────────────────────────
  // Split de expenses por bucket según `bucketOfCategory` (ver
  // `src/lib/finance/expense-categories.ts`):
  //   · direct    → publicidad (atribuible a launches)
  //   · tax       → impuestos (Ganancias, IIBB)
  //   · operating → todo el resto
  // Payouts al equipo (`team_member_payouts`) se suman a `direct` con
  // conversión vía launch.ars_per_usd — comisiones son costo directo del
  // launch. Nómina va en su propia línea del P&L.
  const expensesByBucket = { direct: 0, tax: 0, operating: 0 };
  for (const e of expensesInPeriodUsd) {
    const bucket = bucketOfCategory(e.category);
    expensesByBucket[bucket] += e.amount_gross - e.tax_amount;
  }
  // Payouts: filtro por período para el P&L; el filtro por burnWindow vive
  // más abajo cuando se calcula el burn (mismo query, distintos slices).
  const payoutsInPeriod = payouts.filter((p) =>
    inPeriodDate(p.paid_at, period),
  );
  const payoutsUsdTotal = payoutsInPeriod.reduce(
    (acc, p) => acc + payoutAmountToUsd(p.amount, p.launch_id),
    0,
  );
  const directCostsUsd = expensesByBucket.direct + payoutsUsdTotal;
  const operatingExpensesUsd = expensesByBucket.operating;
  const incomeTaxesUsd = expensesByBucket.tax;
  const payrollTotal = sumPayrollTotal(payrollInPeriodUsd);
  // opExNet queda declarado para compatibilidad con líneas legacy del
  // StatRow abajo (se refiere al total de gastos, sin split).
  const opExNet = sumExpensesNet(expensesInPeriodUsd);

  const profit = computeProfit({
    revenue: revenue.revenueTotal,
    directCosts: directCostsUsd,
    operatingExpenses: operatingExpensesUsd,
    payroll: payrollTotal,
    taxes: incomeTaxesUsd,
  });

  // AR, AP, patrimonio, cash flow — todo consolidado en USD para ser
  // coherente con el ingreso, la utilidad y bancos. Los selectores son
  // agnósticos de moneda: reciben rows ya convertidas.
  //
  // client_transfers convertidos vía tasa org del mes de `date` (aproximación;
  // ver comentario en `transferToUsd`).
  const clientTransfersUsd: FinanceClientTransferRow[] = clientTransfers.map(
    (t) => ({ ...t, amount: transferToUsd(t.amount, t.date) }),
  );
  const assetsUsd: FinanceAssetRow[] = assets.map((a) => ({
    ...a,
    amount: assetToUsd(a),
  }));
  const liabilitiesUsd: FinanceLiabilityRow[] = liabilities.map((l) => ({
    ...l,
    amount: liabilityToUsd(l),
  }));

  const ar = computeAccountsReceivable({
    invoices: invoicesForRevenue, // ya convertidas a USD
    resolveOwnership,
    favorKingrowBalance: Math.max(-clientBalance(clientTransfersUsd), 0),
  });
  const ap = computeAccountsPayable({
    expenses: expensesUsd,
    payroll: payrollUsd,
    clientTransfers: clientTransfersUsd,
  });
  const netWorth = computeNetWorth({
    assets: assetsUsd,
    liabilities: liabilitiesUsd,
    currentPayables: ap.totalPayable,
  });
  // Cash flow real del período = Σ bank_movements 'in' − Σ bank_movements
  // 'out', todo convertido a USD. Los cobros de ventas NO se suman aparte:
  // ya se concilian como bank_movements 'in' cuando entran al banco (por
  // eso los métodos de pago tienen bank_id y el saldo se reconstruye desde
  // los movimientos). Sumar `payments` sería doble conteo.
  const bankMovementsInPeriodUsd = bankMovementsInPeriod.map((m) => ({
    ...m,
    amount: movementToUsd(m),
  }));
  const cashFlow = computeCashFlow({
    bankMovements: bankMovementsInPeriodUsd,
  });

  // ─── Bancos: saldo consolidado en USD sobre todos los bancos activos.
  // Fuente derivada (no snapshot manual): opening_balance + movimientos
  // manuales. ARS convertido a USD con la última tasa mensual disponible a
  // nivel org. Si hay ARS y no hay tasa cargada, `banksTotalUsd` queda null y
  // la UI muestra em-dash + hint.
  const activeBanks = banksList.filter((b) => b.active);
  const bankBalances = computeBankBalances(activeBanks, allBankMovements);
  let banksTotalArsNative = 0;
  let banksTotalUsdNative = 0;
  for (const b of activeBanks) {
    const bal = bankBalances.get(b.id);
    const total = bal?.total ?? Number(b.opening_balance);
    if (b.currency === "USD") banksTotalUsdNative += total;
    else banksTotalArsNative += total;
  }
  let banksTotalUsd: number | null;
  if (banksTotalArsNative === 0) {
    banksTotalUsd = banksTotalUsdNative;
  } else if (latestFx) {
    banksTotalUsd = banksTotalUsdNative + banksTotalArsNative / latestFx.rate;
  } else {
    banksTotalUsd = null;
  }

  // Burn: promedio mensual de TODOS los costos que restan a la utilidad
  // neta — gastos operativos + costos directos (publicidad + payouts) +
  // impuestos + nómina. Ventana FIJA de 3 meses calendario cerrados en
  // KG_TZ (independiente del ?range). Todo en USD.
  const burnExpenses = expensesUsd.filter((e) =>
    inPeriodDate(e.expense_date, burnWindow),
  );
  const burnPayroll = payrollUsd.filter((p) =>
    overlapsPeriodDate(p.period_start, p.period_end, burnWindow),
  );
  const burnPayouts = payouts.filter((p) =>
    inPeriodDate(p.paid_at, burnWindow),
  );
  const burnPayoutsUsd = burnPayouts.reduce(
    (acc, p) => acc + payoutAmountToUsd(p.amount, p.launch_id),
    0,
  );
  const burn = computeBurnRate({
    expenses: burnExpenses,
    payroll: burnPayroll,
    monthsInWindow: burnWindow.monthsInWindow,
    otherCosts: burnPayoutsUsd,
  });

  // Runway: caja de bancos consolidada en USD ÷ burn mensual. Reemplaza el
  // snapshot manual de `assets` — la caja es un derivado en tiempo real
  // (opening_balance + bank_movements). Si `banksTotalUsd` es null (hay
  // saldo ARS sin tasa cargada) `classifyRunway` devuelve reason
  // `no-cash-data` y la UI muestra em-dash con hint.
  const runway = classifyRunway({
    cashOnHand: banksTotalUsd,
    monthlyBurn: burn,
    snapshotStale: false,
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Tendencia mensual (12 meses) — únicamente revenue. Es la ÚNICA serie
  // temporal real a nivel org (regla del artefacto, sección 4 del OK).
  // ═════════════════════════════════════════════════════════════════════════
  // Sparkline: itera sobre las arrays COMPLETAS (no las `*InPeriod`) para tener
  // los 12 meses. Bucket comparte shape con Period (`fromYmd`/`toYmd`), así que
  // reutilizamos las mismas dos funciones — timestamptz vs date — por columna.
  // Sparkline: `resolveOwnership` se calcula UNA vez arriba y se reutiliza
  // en las 12 iteraciones. Pooling explícito porque el hot loop no puede
  // ir a Supabase por bucket (regla del feedback del brief).
  const buckets = lastMonths(12);
  const revenueBuckets = buckets.map((b) => {
    const rev = computeRevenue({
      settlements: settlementsForRevenue.filter((s) => inPeriodTs(s.closed_at, b)),
      invoices: invoicesForRevenue.filter((i) => inPeriodDate(i.paid_at, b)),
      resolveOwnership,
    });
    return { label: b.label, revenue: rev.revenueTotal };
  });

  // Delta MoM: último mes completo vs anterior. Si el buffer último es el
  // mes en curso incompleto, comparar contra el mismo tramo del anterior
  // sería más justo — para 6b uso mes completo vs mes completo (bucket -2
  // vs bucket -3), y solo si ambos > 0.
  let revDelta: { value: string; dir: "up" | "down" } | null = null;
  if (revenueBuckets.length >= 3) {
    const lastFull = revenueBuckets[revenueBuckets.length - 2];
    const prevFull = revenueBuckets[revenueBuckets.length - 3];
    if (lastFull && prevFull && prevFull.revenue > 0) {
      const pct = (lastFull.revenue - prevFull.revenue) / prevFull.revenue;
      revDelta = { value: fPct(Math.abs(pct)), dir: pct >= 0 ? "up" : "down" };
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // Estructura de egresos — expenses agrupados por category + payroll +
  // comisiones al equipo. Todo en USD para ser consistente con el P&L.
  // ═════════════════════════════════════════════════════════════════════════
  const catMap = new Map<string, number>();
  for (const e of expensesInPeriodUsd) {
    const cat = (e.category ?? "Sin categoría").trim() || "Sin categoría";
    const net = e.amount_gross - e.tax_amount;
    catMap.set(cat, (catMap.get(cat) ?? 0) + net);
  }
  const expenseCategories: FinancieroDashboardData["expenseCategories"] = [
    ...Array.from(catMap.entries())
      .map(([label, amount]) => ({ label: capitalize(label), amount }))
      .sort((a, b) => b.amount - a.amount),
    ...(payrollTotal > 0 ? [{ label: "Nómina", amount: payrollTotal }] : []),
    ...(payoutsUsdTotal > 0
      ? [{ label: "Comisiones equipo", amount: payoutsUsdTotal }]
      : []),
  ];

  // ═════════════════════════════════════════════════════════════════════════
  // Liquidaciones por lanzamiento — filas del período con nombre del launch.
  // ═════════════════════════════════════════════════════════════════════════
  const launchSettlements: LaunchSettlementRow[] = settlementsInPeriod
    .slice()
    .sort((a, b) => (b.closed_at ?? "").localeCompare(a.closed_at ?? ""))
    .slice(0, 20)
    .map((s) => ({
      launchName:
        launchNameById.get(s.launch_id) ?? `Lanzamiento ${s.launch_id.slice(0, 6)}`,
      collected: s.collected_total,
      retained: s.kingrow_retained,
      owed: s.owed_to_client,
      status: s.status,
    }));

  // ═════════════════════════════════════════════════════════════════════════
  // P&L breakdown para el panel "Estado de resultados" y drawer de utilidad.
  // Ingresos (+), Costos directos (−), Gastos operativos (−), Nómina (−),
  // Impuestos (−). Todo en USD.
  // ═════════════════════════════════════════════════════════════════════════
  const plParts: FinancieroDashboardData["plParts"] = [
    { l: "Ingresos", v: revenue.revenueTotal },
    { l: "Costos directos (ads + comisiones)", v: -directCostsUsd },
    { l: "Gastos operativos (neto IVA)", v: -operatingExpensesUsd },
    { l: "Nómina", v: -payrollTotal },
    { l: "Impuestos (Ganancias, IIBB)", v: -incomeTaxesUsd },
  ];

  // ═════════════════════════════════════════════════════════════════════════
  // Sources — metadata declarada en UN solo lugar (acá). El drawer los renderiza.
  // ═════════════════════════════════════════════════════════════════════════
  const data: FinancieroDashboardData = {
    period: {
      key: period.key,
      label: period.label,
      rangeStart: period.fromYmd,
      rangeEnd: period.toYmd,
    },
    counts: {
      invoicesPending: ar.invoicesCount,
      settlementsInPeriod: settlementsInPeriod.length,
      expensesInPeriod: expensesInPeriod.length,
      payrollInPeriod: payrollInPeriod.length,
      invoicesMissingProject: invoiceDataQuality.missingProject,
      invoicesMissingLaunch: invoiceDataQuality.missingLaunch,
    },
    stats: {
      // Total de egresos del período (todas las categorías, ya USD). Se
      // muestra en el StatRow como "Gastos del período" — sigue siendo la
      // suma completa aunque el P&L lo divida en 3 buckets.
      expensesTotal: opExNet,
      payrollTotal,
      clientBalance: clientBalance(
        clientTransfersInPeriod.map((t) => ({
          ...t,
          amount: transferToUsd(t.amount, t.date),
        })),
      ),
      // Contexto separado del AR de Kingrow — regla 6b-rev: magnitudes
      // distintas nunca sumadas. Se muestran en el StatRow (nivel 3) con
      // conteo aparte para que quede claro que son cobros ajenos.
      thirdPartyReceivable: ar.thirdPartyReceivableNet,
      thirdPartyReceivableCount: ar.thirdPartyCount,
    },
    revenue: {
      value: revenue.revenueTotal,
      tone: "positive",
      parts: [
        {
          l: "Liquidaciones externas (Kingrow retenido)",
          v: revenue.revenueFromSettlements,
        },
        {
          l: "Facturas cobradas de empresas propias",
          v: revenue.revenueFromDirectSales,
        },
        { l: "Otros ingresos", v: revenue.otherIncome },
      ],
    },
    groupVolume: {
      value: groupInvoicing.totalNet,
      count: groupInvoicing.count,
    },
    revenueSeries: { buckets: revenueBuckets, delta: revDelta },
    netProfit: {
      value: profit.netProfit,
      tone: profit.netProfit >= 0 ? "positive" : "negative",
      parts: plParts,
    },
    banks: {
      totalUsd: banksTotalUsd,
      bankCount: activeBanks.length,
      fxMonth: latestFx?.month ?? null,
      needsFxRate: banksTotalArsNative !== 0 && latestFx === null,
    },
    runway,
    burn,
    cashFlow: {
      value: cashFlow.netCashFlow,
      tone: cashFlow.netCashFlow >= 0 ? "positive" : "negative",
      parts: [
        { l: "Entradas", v: cashFlow.cashIn },
        { l: "Salidas", v: -cashFlow.cashOut },
      ],
    },
    margin: profit.netMargin,
    ar: {
      value: ar.totalReceivable,
      tone: "warning",
      parts: [
        { l: "Facturas por cobrar (neto)", v: ar.invoicesReceivableNet },
        { l: "Saldo a favor de Kingrow", v: ar.favorKingrowBalance },
      ],
    },
    ap: {
      value: ap.totalPayable,
      tone: "negative",
      parts: [
        { l: "Gastos por pagar (neto)", v: ap.expensesPayableNet },
        { l: "Nómina por pagar", v: ap.payrollPayable },
        { l: "Debido a clientes", v: ap.clientPayable },
      ],
    },
    equity: {
      value: netWorth.netWorth,
      tone: netWorth.netWorth >= 0 ? "positive" : "negative",
      parts: [
        { l: "Activos", v: netWorth.totalAssets },
        { l: "Pasivos", v: -netWorth.totalLiabilities },
        { l: "Cuentas por pagar corrientes", v: -netWorth.currentPayables },
      ],
    },
    plParts,
    plNet: profit.netProfit,
    expenseCategories,
    launchSettlements,
  };

  return <FinancieroDashboard data={data} />;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
