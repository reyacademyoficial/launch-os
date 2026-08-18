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

import { RangePills, type PresetOption } from "../range-pills";

import { ImportMovementsButton } from "./import-drawer";
import type { BankOption } from "./movement-form-drawer";
import {
  MovimientosView,
  type MovementConciliation,
  type MovementRowData,
} from "./movimientos-view";
import { NewMovementButton } from "./new-movement-button";

export const metadata: Metadata = { title: "Movimientos · Financiero" };

const PAGE_SIZE = 50;

type KindParam = "todos" | "in" | "out";
type ConcilParam = "todos" | "conciliados" | "sin-conciliar";
type RangeParam = "todo" | "mes-actual" | "mes-anterior" | "90d" | "custom";

const KIND_OPTIONS: ReadonlyArray<{ value: KindParam; label: string }> = [
  { value: "todos", label: "Todos" },
  { value: "in", label: "Entradas" },
  { value: "out", label: "Salidas" },
];
const CONCIL_OPTIONS: ReadonlyArray<{ value: ConcilParam; label: string }> = [
  { value: "todos", label: "Todos" },
  { value: "conciliados", label: "Conciliados" },
  { value: "sin-conciliar", label: "Sin conciliar" },
];
const RANGE_PRESETS: readonly PresetOption[] = [
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
  readonly currency: "ARS" | "USD";
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
  const concilParam = parseConcil(sp.concil);
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
  const allMovements = (movRes.data ?? []) as unknown as MovementDbRow[];

  // ─── Set global de movimientos conciliados en la vista ─────────────────
  //
  // Un movimiento cuenta como CONCILIADO si aparece linkeado en al menos una
  // de las 4 tablas satélite: invoice_bank_movements, expense_bank_movements,
  // payroll.bank_movement_id, client_transfers.bank_movement_id. Los dos
  // primeros son bridge N:M (0117/0119); los otros dos siguen siendo 1:1 con
  // columna FK directa (nunca se migraron a bridge porque nómina y
  // transferencia-a-cliente no tienen caso de "comisión separada" hoy).
  //
  // Traemos los ids de linkeo por separado para no depender de un JOIN N:M
  // grande; el set completo cabe en RAM (típicamente <10k ids en total).
  const allInPeriodIds = allMovements.map((m) => m.id);
  const linkedIds = await loadLinkedMovementIds(supabase, allInPeriodIds);

  // Aplicar filtro de conciliación en TS — no hay una forma limpia de
  // hacerlo desde SQL sin construir el set primero.
  const filteredByConcil = allMovements.filter((m) => {
    if (concilParam === "conciliados") return linkedIds.has(m.id);
    if (concilParam === "sin-conciliar") return !linkedIds.has(m.id);
    return true;
  });

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

  const totalCount = filteredByConcil.length;
  const paged = filteredByConcil.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const cashIn = filteredByConcil
    .filter((m) => m.kind === "in")
    .reduce((a, m) => a + Number(m.amount), 0);
  const cashOut = filteredByConcil
    .filter((m) => m.kind === "out")
    .reduce((a, m) => a + Number(m.amount), 0);
  const net = cashIn - cashOut;

  const unconciledGlobalCount = allMovements.filter(
    (m) => !linkedIds.has(m.id),
  ).length;

  // ─── Conciliaciones detalladas para las filas de la página ─────────────
  //
  // Cargamos las 4 fuentes SOLO para los ids paginados — cada fila puede
  // tener 1..N conciliaciones (un mismo movimiento podría ser principal de
  // un gasto Y comisión de una factura, por ejemplo). El drawer de detalle
  // muestra todas.
  const pagedIds = paged.map((m) => m.id);
  const conciliationsById = await loadConciliations(supabase, pagedIds);

  // Sugerencia por Nº transacción: si el movimiento no está ligado a NINGUNA
  // factura, y su transaction_number matchea una factura emitida, sugerimos
  // vincular con un click desde la fila.
  const invoicesForSuggestionRes = await supabase
    .from("invoices")
    .select("id, invoice_number, transaction_number")
    .eq("status", "emitida")
    .not("transaction_number", "is", null);

  interface SuggestedInvoiceRow {
    readonly id: string;
    readonly invoice_number: string | null;
    readonly transaction_number: string;
  }
  const suggestedInvoices = (invoicesForSuggestionRes.data ??
    []) as unknown as SuggestedInvoiceRow[];

  const suggestedByTx = new Map<
    string,
    { invoiceId: string; invoiceNumber: string | null }
  >();
  for (const inv of suggestedInvoices) {
    if (!suggestedByTx.has(inv.transaction_number)) {
      suggestedByTx.set(inv.transaction_number, {
        invoiceId: inv.id,
        invoiceNumber: inv.invoice_number,
      });
    }
  }

  const rows: MovementRowData[] = paged.map((m) => {
    const bank = bankById.get(m.bank_id);
    const conciliations = conciliationsById.get(m.id) ?? [];
    const hasInvoiceLink = conciliations.some((c) => c.kind === "invoice");
    let invoiceLink: MovementRowData["invoiceLink"] = null;
    const primaryInvoice = conciliations.find((c) => c.kind === "invoice");
    if (primaryInvoice && primaryInvoice.kind === "invoice") {
      invoiceLink = {
        kind: "linked",
        invoiceId: primaryInvoice.id,
        invoiceNumber: primaryInvoice.label,
        role: primaryInvoice.role,
      };
    } else if (!hasInvoiceLink && m.transaction_number && m.kind === "in") {
      const suggestion = suggestedByTx.get(m.transaction_number);
      if (suggestion) {
        invoiceLink = {
          kind: "suggested",
          invoiceId: suggestion.invoiceId,
          invoiceNumber: suggestion.invoiceNumber,
        };
      }
    }
    return {
      id: m.id,
      bankId: m.bank_id,
      bankName: bank?.name ?? "—",
      bankCurrency: bank?.currency ?? "ARS",
      projectName: bank?.project_id
        ? projectNameById.get(bank.project_id) ?? "—"
        : "—",
      kind: m.kind,
      amount: Number(m.amount),
      occurredAt: m.occurred_at,
      description: m.description ?? "",
      transactionNumber: m.transaction_number,
      invoiceLink,
      conciliations,
    };
  });

  const banksForDrawer: BankOption[] = banks.map((b) => ({
    id: b.id,
    name: b.name,
    active: b.active,
    currency: b.currency,
  }));

  function buildHref(overrides: {
    kind?: KindParam;
    concil?: ConcilParam;
    page?: number;
  }): string {
    const nextKind = overrides.kind ?? kindParam;
    const nextConcil = overrides.concil ?? concilParam;
    const nextPage = overrides.page ?? page;
    const params = new URLSearchParams();
    if (nextKind !== "todos") params.set("kind", nextKind);
    if (nextConcil !== "todos") params.set("concil", nextConcil);
    if (isCustom && fromParam && toParam) {
      params.set("from", fromParam);
      params.set("to", toParam);
    } else if (rangeParam !== "todo") {
      params.set("range", rangeParam);
    }
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
          {
            l: "Sin conciliar (todo el rango)",
            v: fCount(unconciledGlobalCount),
            c: unconciledGlobalCount > 0 ? "#FFB800" : undefined,
          },
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
          ariaLabel="Filtrar por estado de conciliación"
          options={CONCIL_OPTIONS.map((o) => ({
            label: o.label,
            href: buildHref({ concil: o.value, page: 1 }),
            active: concilParam === o.value,
          }))}
        />
        <RangePills
          presets={RANGE_PRESETS}
          activePreset={isCustom ? null : rangeParam === "custom" ? null : rangeParam}
          activeFrom={period?.fromYmd ?? null}
          activeTo={period?.toYmd ?? null}
          baseHref="/financiero/movimientos"
        />
      </div>

      <Panel
        title="Ingresos y egresos bancarios"
        pad={false}
        actions={
          <div style={{ display: "inline-flex", gap: 8 }}>
            <a
              href={buildExportHref(kindParam, rangeParam, fromParam, toParam)}
              className="kg-focus"
              style={{
                padding: "6px 14px",
                borderRadius: 999,
                background: "transparent",
                border: "1px solid var(--kg-border-subtle)",
                color: "var(--kg-text-2)",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
              }}
              title="Exportar la vista actual a Excel"
            >
              Exportar Excel
            </a>
            <ImportMovementsButton banks={banksForDrawer} />
            <NewMovementButton banks={banksForDrawer} />
          </div>
        }
      >
        <MovimientosView
          rows={rows}
          totalCount={totalCount}
          banks={banksForDrawer}
          footerActions={
            <KgPaginator
              page={page}
              pageSize={PAGE_SIZE}
              totalCount={totalCount}
              hrefFor={(n) => buildHref({ page: n })}
              compact
            />
          }
        />
      </Panel>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Fetchers de conciliación
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Devuelve el set de ids de movimientos que ya están linkeados a AL MENOS
 * una factura / gasto / nómina / transferencia. Alimenta el filtro
 * "Sin conciliar" y el contador global de la ContextBar.
 *
 * Post 0129: consulta los 4 bridges (invoice/expense/payroll/transfer)
 * Y las FKs viejas de payroll/client_transfers (mientras haya rows con
 * la col vieja seteada pre-migración; el bridge las tiene backfilleadas
 * pero la col vieja no se limpia).
 */
async function loadLinkedMovementIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  movementIds: readonly string[],
): Promise<Set<string>> {
  const linked = new Set<string>();
  if (movementIds.length === 0) return linked;

  const [invRes, expRes, pbmRes, ctbmRes, payFkRes, ctFkRes] =
    await Promise.all([
      supabase
        .from("invoice_bank_movements")
        .select("bank_movement_id")
        .in("bank_movement_id", movementIds),
      supabase
        .from("expense_bank_movements")
        .select("bank_movement_id")
        .in("bank_movement_id", movementIds),
      supabase
        .from("payroll_bank_movements")
        .select("bank_movement_id")
        .in("bank_movement_id", movementIds),
      supabase
        .from("client_transfer_bank_movements")
        .select("bank_movement_id")
        .in("bank_movement_id", movementIds),
      supabase
        .from("payroll")
        .select("bank_movement_id")
        .in("bank_movement_id", movementIds),
      supabase
        .from("client_transfers")
        .select("bank_movement_id")
        .in("bank_movement_id", movementIds),
    ]);

  for (const res of [invRes, expRes, pbmRes, ctbmRes]) {
    for (const r of (res.data ?? []) as { bank_movement_id: string }[]) {
      linked.add(r.bank_movement_id);
    }
  }
  for (const res of [payFkRes, ctFkRes]) {
    for (const r of (res.data ?? []) as {
      bank_movement_id: string | null;
    }[]) {
      if (r.bank_movement_id) linked.add(r.bank_movement_id);
    }
  }
  return linked;
}

/**
 * Trae el detalle completo de conciliaciones para los movimientos paginados.
 * Un movimiento puede aparecer atado a varias filas satélite — devolvemos
 * todas para que el drawer de detalle las liste sin ocultar nada.
 */
async function loadConciliations(
  supabase: Awaited<ReturnType<typeof createClient>>,
  movementIds: readonly string[],
): Promise<Map<string, MovementConciliation[]>> {
  const out = new Map<string, MovementConciliation[]>();
  if (movementIds.length === 0) return out;

  interface InvBridgeRow {
    readonly bank_movement_id: string;
    readonly invoice_id: string;
    readonly role: "principal" | "comision" | "otro";
    readonly invoices: { invoice_number: string | null; amount_gross: number } | null;
  }
  interface ExpBridgeRow {
    readonly bank_movement_id: string;
    readonly expense_id: string;
    readonly role: "principal" | "comision" | "otro";
    readonly expenses: {
      description: string | null;
      amount_gross: number;
    } | null;
  }
  interface PayBridgeRow {
    readonly bank_movement_id: string;
    readonly payroll_id: string;
    readonly role: "principal" | "comision" | "otro";
    readonly payroll: {
      id: string;
      total_amount: number;
      period_start: string;
      period_end: string;
      person_id: string;
    } | null;
  }
  interface CtBridgeRow {
    readonly bank_movement_id: string;
    readonly client_transfer_id: string;
    readonly role: "principal" | "comision" | "otro";
    readonly client_transfers: {
      id: string;
      amount: number;
      project_id: string;
      launch_settlement_id: string | null;
    } | null;
  }
  // Filas ligadas por FK vieja (pre-bridge) — se preservan hasta que la col
  // se limpie en migración posterior. Un movimiento puede estar SOLO en la
  // col vieja si nunca pasó por el bridge.
  interface PayFkRow {
    readonly id: string;
    readonly bank_movement_id: string;
    readonly total_amount: number;
    readonly period_start: string;
    readonly period_end: string;
    readonly person_id: string;
  }
  interface CtFkRow {
    readonly id: string;
    readonly bank_movement_id: string;
    readonly amount: number;
    readonly project_id: string;
    readonly launch_settlement_id: string | null;
  }

  const [invRes, expRes, payBridgeRes, ctBridgeRes, payFkRes, ctFkRes] =
    await Promise.all([
      supabase
        .from("invoice_bank_movements")
        .select(
          "bank_movement_id, invoice_id, role, invoices!inner(invoice_number, amount_gross)",
        )
        .in("bank_movement_id", movementIds),
      supabase
        .from("expense_bank_movements")
        .select(
          "bank_movement_id, expense_id, role, expenses!inner(description, amount_gross)",
        )
        .in("bank_movement_id", movementIds),
      supabase
        .from("payroll_bank_movements")
        .select(
          "bank_movement_id, payroll_id, role, payroll!inner(id, total_amount, period_start, period_end, person_id)",
        )
        .in("bank_movement_id", movementIds),
      supabase
        .from("client_transfer_bank_movements")
        .select(
          "bank_movement_id, client_transfer_id, role, client_transfers!inner(id, amount, project_id, launch_settlement_id)",
        )
        .in("bank_movement_id", movementIds),
      supabase
        .from("payroll")
        .select("id, bank_movement_id, total_amount, period_start, period_end, person_id")
        .in("bank_movement_id", movementIds),
      supabase
        .from("client_transfers")
        .select("id, bank_movement_id, amount, project_id, launch_settlement_id")
        .in("bank_movement_id", movementIds),
    ]);

  function push(mvId: string, c: MovementConciliation) {
    const cur = out.get(mvId) ?? [];
    cur.push(c);
    out.set(mvId, cur);
  }

  for (const r of (invRes.data ?? []) as unknown as InvBridgeRow[]) {
    push(r.bank_movement_id, {
      kind: "invoice",
      id: r.invoice_id,
      role: r.role,
      label: r.invoices?.invoice_number ?? "s/n",
      amount: Number(r.invoices?.amount_gross ?? 0),
    });
  }
  for (const r of (expRes.data ?? []) as unknown as ExpBridgeRow[]) {
    push(r.bank_movement_id, {
      kind: "expense",
      id: r.expense_id,
      role: r.role,
      label: r.expenses?.description ?? "Gasto s/descripción",
      amount: Number(r.expenses?.amount_gross ?? 0),
    });
  }

  // Nómina: unimos bridge + FK vieja, con dedupe por (mvId, payrollId) —
  // el bridge tiene role, la FK vieja no (se asume 'principal'). El dedupe
  // previene doble render cuando el backfill del 0129 dejó las dos rutas.
  const payBridgeRows = (payBridgeRes.data ?? []) as unknown as PayBridgeRow[];
  const payFkRows = (payFkRes.data ?? []) as unknown as PayFkRow[];
  const payloadByMvPay = new Map<
    string,
    {
      mvId: string;
      payrollId: string;
      role: "principal" | "comision" | "otro";
      totalAmount: number;
      periodStart: string;
      periodEnd: string;
      personId: string;
    }
  >();
  for (const r of payBridgeRows) {
    if (!r.payroll) continue;
    payloadByMvPay.set(`${r.bank_movement_id}:${r.payroll_id}`, {
      mvId: r.bank_movement_id,
      payrollId: r.payroll.id,
      role: r.role,
      totalAmount: Number(r.payroll.total_amount),
      periodStart: r.payroll.period_start,
      periodEnd: r.payroll.period_end,
      personId: r.payroll.person_id,
    });
  }
  for (const r of payFkRows) {
    const key = `${r.bank_movement_id}:${r.id}`;
    if (payloadByMvPay.has(key)) continue; // ya vino por bridge
    payloadByMvPay.set(key, {
      mvId: r.bank_movement_id,
      payrollId: r.id,
      role: "principal",
      totalAmount: Number(r.total_amount),
      periodStart: r.period_start,
      periodEnd: r.period_end,
      personId: r.person_id,
    });
  }
  const personIds = Array.from(
    new Set(Array.from(payloadByMvPay.values()).map((p) => p.personId)),
  );
  const personNameById = new Map<string, string>();
  if (personIds.length > 0) {
    const { data } = await supabase
      .from("organization_people")
      .select("id, full_name")
      .in("id", personIds);
    for (const p of (data ?? []) as { id: string; full_name: string }[]) {
      personNameById.set(p.id, p.full_name);
    }
  }
  for (const p of payloadByMvPay.values()) {
    push(p.mvId, {
      kind: "payroll",
      id: p.payrollId,
      role: p.role,
      label: `${personNameById.get(p.personId) ?? "—"} · ${fmtShort(p.periodStart)}–${fmtShort(p.periodEnd)}`,
      amount: p.totalAmount,
    });
  }

  // Transferencia a cliente: mismo dedupe (bridge + FK vieja).
  const ctBridgeRows = (ctBridgeRes.data ?? []) as unknown as CtBridgeRow[];
  const ctFkRows = (ctFkRes.data ?? []) as unknown as CtFkRow[];
  const ctByMvCt = new Map<
    string,
    {
      mvId: string;
      ctId: string;
      role: "principal" | "comision" | "otro";
      amount: number;
      projectId: string;
    }
  >();
  for (const r of ctBridgeRows) {
    if (!r.client_transfers) continue;
    ctByMvCt.set(`${r.bank_movement_id}:${r.client_transfer_id}`, {
      mvId: r.bank_movement_id,
      ctId: r.client_transfers.id,
      role: r.role,
      amount: Number(r.client_transfers.amount),
      projectId: r.client_transfers.project_id,
    });
  }
  for (const r of ctFkRows) {
    const key = `${r.bank_movement_id}:${r.id}`;
    if (ctByMvCt.has(key)) continue;
    ctByMvCt.set(key, {
      mvId: r.bank_movement_id,
      ctId: r.id,
      role: "principal",
      amount: Number(r.amount),
      projectId: r.project_id,
    });
  }
  const ctProjectIds = Array.from(
    new Set(Array.from(ctByMvCt.values()).map((c) => c.projectId)),
  );
  const ctProjectNameById = new Map<string, string>();
  if (ctProjectIds.length > 0) {
    const { data } = await supabase
      .from("projects")
      .select("id, name")
      .in("id", ctProjectIds);
    for (const p of (data ?? []) as { id: string; name: string }[]) {
      ctProjectNameById.set(p.id, p.name);
    }
  }
  for (const c of ctByMvCt.values()) {
    push(c.mvId, {
      kind: "transfer",
      id: c.ctId,
      role: c.role,
      label: `Transferencia a ${ctProjectNameById.get(c.projectId) ?? "cliente"}`,
      amount: c.amount,
    });
  }

  return out;
}

function fmtShort(ymd: string): string {
  // "2026-08-01" → "08/26" — el detalle completo va en el drawer.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  return `${ymd.slice(5, 7)}/${ymd.slice(2, 4)}`;
}

function buildExportHref(
  kind: KindParam,
  range: RangeParam,
  from: string | null,
  to: string | null,
): string {
  const params = new URLSearchParams();
  if (kind !== "todos") params.set("kind", kind);
  if (from && to) {
    params.set("from", from);
    params.set("to", to);
  } else if (range !== "todo") {
    params.set("range", range);
  }
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
function parseConcil(v: string | string[] | undefined): ConcilParam {
  if (typeof v !== "string") return "todos";
  const allowed: ConcilParam[] = ["todos", "conciliados", "sin-conciliar"];
  return (allowed as string[]).includes(v) ? (v as ConcilParam) : "todos";
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
