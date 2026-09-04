"use client";

import { KgFilterSelectControlled as FilterSelect } from "@/components/kg/filter-select";

import { useMemo, useState, type CSSProperties } from "react";

import {
  KgDataTable,
  KgSelectionBar,
  type Column,
} from "@/components/kg/data-table";
import { dangerBtn, primaryBtn } from "@/components/kg/form-primitives";
import { KgPageFilters } from "@/components/kg/page-menu";
import { Panel } from "@/components/kg/panel";
import { RangePills } from "@/components/kg/range-pills";
import { StateDot } from "@/components/kg/state-dot";
import { StatusPill } from "@/components/kg/status-pill";
import { TONE_VAR } from "@/components/kg/tone";
import type {
  PaymentActionState,
  SaleActionState,
} from "@/app/(app)/(kg)/proyectos/[projectId]/leads/sale-actions";
import { buildSaleRanks } from "@/lib/commissions/ranking";
import type {
  CommissionRuleRow,
  InstallmentRow,
  PaymentModalityRow,
  PaymentRow,
  SaleRow,
} from "@/lib/commissions/types";
import { fmtDate, fmtMoney, fmtNumber } from "@/lib/format";
import {
  fmtNative,
  fmtUsd,
  normalizePaymentsForSaleCurrency,
  type Currency,
  type FxLookup,
} from "@/lib/money";
import {
  computeInstallmentStatuses,
  summarizeSaleOverdue,
  todayInAR,
  type SaleOverdueSummary,
} from "@/lib/installments/status";
import type { LeadRow } from "@/lib/leads/types";
import type { PaymentMethodRow } from "@/lib/payment-methods/types";
import type { ProductRow } from "@/lib/products/types";
import type { TeamMemberRow } from "@/lib/team/types";

import { SaleModal } from "./sale-modal";

type CreateSaleAction = (
  leadId: string,
  prev: SaleActionState,
  formData: FormData,
) => Promise<SaleActionState>;
type AddPaymentAction = (
  saleId: string,
  prev: PaymentActionState,
  formData: FormData,
) => Promise<PaymentActionState>;
type DeletePaymentAction = (paymentId: string) => Promise<void>;
type DeleteSaleAction = (saleId: string) => Promise<void>;
type UpdateSaleProductAction = (
  saleId: string,
  productId: string,
  regenerate?: boolean,
) => Promise<{ ok: true } | { error: string }>;
type RecalculateSaleAction = (
  saleId: string,
) => Promise<{ ok: true } | { error: string }>;
type UpdateSaleAction = (
  saleId: string,
  prev: SaleActionState,
  formData: FormData,
) => Promise<SaleActionState>;
type UpdatePaymentInstallmentAction = (
  paymentId: string,
  installmentId: string | null,
) => Promise<{ ok: true } | { error: string }>;
type UpdatePaymentMethodAction = (
  paymentId: string,
  paymentMethodId: string | null,
) => Promise<{ ok: true } | { error: string }>;
type AssignLeadOwnerAction = (
  leadId: string,
  teamMemberId: string | null,
) => Promise<{ ok: true } | { error: string }>;

type LeadForCobros = Pick<
  LeadRow,
  "id" | "name" | "launch_id" | "team_member_id" | "status"
>;

type CollectionStatus = "all" | "paid" | "partial" | "unpaid";

interface FilterState {
  query: string;
  launchId: string;
  closerId: string;
  modalityId: string;
  productId: string;
  collection: CollectionStatus;
}

const EMPTY_FILTERS: FilterState = {
  query: "",
  launchId: "all",
  closerId: "all",
  modalityId: "all",
  productId: "all",
  collection: "all",
};

const UNASSIGNED_LAUNCH = "__unassigned__";

/**
 * Resumen del cobrado de una venta que respeta la moneda. Si todos los
 * payments comparten la moneda de la venta, devolvemos la suma nativa en
 * esa moneda. Si hay al menos un payment en moneda distinta, marcamos
 * `mixed=true` y devolvemos el equivalente USD (evita el bug de sumar
 * pesos + dólares como si fueran la misma unidad).
 */
interface CollectedDisplay {
  amount: number;
  currency: Currency;
  mixed: boolean;
  /** true si algún payment no pudo convertirse a USD por falta de tasa. */
  missingRate: boolean;
}
function collectedForSale(
  saleCurrency: Currency,
  payments: ReadonlyArray<PaymentRow>,
  fxLookup: FxLookup | undefined,
): CollectedDisplay {
  if (payments.length === 0) {
    return { amount: 0, currency: saleCurrency, mixed: false, missingRate: false };
  }
  if (!fxLookup) {
    let sum = 0;
    for (const p of payments) sum += Number(p.amount) || 0;
    return { amount: sum, currency: saleCurrency, mixed: false, missingRate: false };
  }
  let allNative = 0;
  let allSameCurrency = true;
  for (const p of payments) {
    const c = fxLookup.byPaymentId[p.id]?.currency ?? saleCurrency;
    if (c !== saleCurrency) {
      allSameCurrency = false;
      break;
    }
    allNative += Number(p.amount) || 0;
  }
  if (allSameCurrency) {
    return {
      amount: allNative,
      currency: saleCurrency,
      mixed: false,
      missingRate: false,
    };
  }
  let usdSum = 0;
  let missingRate = false;
  for (const p of payments) {
    const usd = fxLookup.byPaymentId[p.id]?.amountUsd ?? null;
    if (usd === null) missingRate = true;
    else usdSum += usd;
  }
  return { amount: usdSum, currency: "USD", mixed: true, missingRate };
}

/**
 * Clasificador de estado de cobro FX-aware. Si el sale y todos los payments
 * comparten moneda, comparamos en unidades nativas contra `total_amount`. Si
 * hay mismatch, comparamos el cobrado(USD) contra `totalUsd`. Cuando no hay
 * `totalUsd` disponible (sale sin conversión), degradamos al criterio crudo
 * — imperfecto, pero preserva el filtro en vez de romperlo.
 */
function classifySaleStatus(
  sale: SaleRow,
  payments: ReadonlyArray<PaymentRow>,
  fxLookup: FxLookup | undefined,
): "paid" | "partial" | "unpaid" {
  const saleCurrency: Currency =
    fxLookup?.bySaleId[sale.id]?.currency ?? "ARS";
  const collected = collectedForSale(saleCurrency, payments, fxLookup);
  const total = Number(sale.total_amount) || 0;
  if (collected.mixed) {
    const usdTotal = fxLookup?.bySaleId[sale.id]?.totalUsd ?? null;
    if (usdTotal !== null && usdTotal > 0) {
      if (collected.amount <= 0) return "unpaid";
      return collected.amount >= usdTotal ? "paid" : "partial";
    }
  }
  if (collected.amount <= 0) return "unpaid";
  return collected.amount >= total ? "paid" : "partial";
}

/**
 * Vista interactiva del tab Cobros. Fase 11: la tabla principal se reduce a
 * los KPIs "de cobro" (Pactado, Cobrado, Vencido, # Cuotas vencidas, Próx
 * vencimiento) y el detalle completo (closer, producto, modalidad, fecha
 * cierre, cronograma) vive en la ficha del alumno = SaleModal.
 */
export function CobrosView({
  sales,
  payments,
  installments,
  invoices,
  leads,
  launches,
  modalities,
  products,
  rules,
  paymentMethods,
  teamMembers,
  canEdit,
  fxLookup,
  methodCurrencies,
  createSaleAction,
  addPaymentAction,
  deletePaymentAction,
  deleteSaleAction,
  updateSaleProductAction,
  recalculateSaleAction,
  updateSaleAction,
  updatePaymentInstallmentAction,
  updatePaymentMethodAction,
  assignLeadOwnerAction,
  hideCommission = false,
}: {
  readonly sales: ReadonlyArray<SaleRow>;
  readonly payments: ReadonlyArray<PaymentRow>;
  readonly installments: ReadonlyArray<InstallmentRow>;
  /** Facturas emitidas por venta — Paso 5. Vacío en callers legacy. */
  readonly invoices?: ReadonlyArray<{
    readonly id: string;
    readonly sale_id: string | null;
    readonly invoice_number: string | null;
    readonly installment_id: string | null;
    readonly amount_gross: number;
    readonly status: string;
  }>;
  readonly leads: ReadonlyArray<LeadForCobros>;
  /**
   * Universo de launches para el filtro. Omitido → vista por launch única
   * (no se muestra el filtro). Presente → vista project-wide con dropdown.
   */
  readonly launches?: ReadonlyArray<{ id: string; name: string }>;
  readonly modalities: ReadonlyArray<PaymentModalityRow>;
  readonly products: ReadonlyArray<ProductRow>;
  readonly rules: ReadonlyArray<CommissionRuleRow>;
  readonly paymentMethods: ReadonlyArray<PaymentMethodRow>;
  readonly teamMembers: ReadonlyArray<
    Pick<TeamMemberRow, "id" | "name" | "active" | "role">
  >;
  readonly canEdit: boolean;
  /**
   * Lookup FX opcional. Cuando se pasa, cada fila se muestra en su moneda
   * nativa (AR$/US$) y el footer suma en USD. Sin fxLookup, fallback al
   * comportamiento antiguo que asume una única moneda implícita.
   */
  readonly fxLookup?: FxLookup;
  readonly methodCurrencies: Record<string, "ARS" | "USD">;
  readonly createSaleAction: CreateSaleAction;
  readonly addPaymentAction: AddPaymentAction;
  readonly deletePaymentAction: DeletePaymentAction;
  readonly deleteSaleAction: DeleteSaleAction;
  readonly updateSaleProductAction: UpdateSaleProductAction;
  readonly recalculateSaleAction: RecalculateSaleAction;
  readonly updateSaleAction: UpdateSaleAction;
  readonly updatePaymentInstallmentAction: UpdatePaymentInstallmentAction;
  readonly updatePaymentMethodAction: UpdatePaymentMethodAction;
  readonly assignLeadOwnerAction: AssignLeadOwnerAction;
  /**
   * Propaga a la ficha del alumno (SaleModal) para ocultar la comisión y el
   * botón de recalcular. Usado para el rol `closer`.
   */
  readonly hideCommission?: boolean;
}) {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  /**
   * Remonta el <input> de búsqueda cuando se limpian los filtros. El input
   * del drawer es NO controlado (ver `CobrosFilters`), así que la única forma
   * de que refleje un reset externo es cambiarle la `key` — nunca un
   * `setState` dentro de un efecto, que el ESLint del repo prohíbe.
   */
  const [searchKey, setSearchKey] = useState(0);

  const leadById = useMemo(
    () => new Map(leads.map((l) => [l.id, l])),
    [leads],
  );
  const modalityById = useMemo(
    () => new Map(modalities.map((m) => [m.id, m])),
    [modalities],
  );
  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );
  const paymentMethodById = useMemo(
    () => new Map(paymentMethods.map((m) => [m.id, m])),
    [paymentMethods],
  );

  const collectedBySale = useMemo(() => {
    const out = new Map<string, number>();
    for (const p of payments) {
      out.set(p.sale_id, (out.get(p.sale_id) ?? 0) + Number(p.amount));
    }
    return out;
  }, [payments]);

  const installmentsBySaleId = useMemo(() => {
    const out = new Map<string, InstallmentRow[]>();
    for (const inst of installments) {
      const arr = out.get(inst.sale_id);
      if (arr) arr.push(inst);
      else out.set(inst.sale_id, [inst]);
    }
    return out;
  }, [installments]);

  const paymentsBySaleId = useMemo(() => {
    const out = new Map<string, PaymentRow[]>();
    for (const p of payments) {
      const arr = out.get(p.sale_id);
      if (arr) arr.push(p);
      else out.set(p.sale_id, [p]);
    }
    return out;
  }, [payments]);

  const invoicesBySaleId = useMemo(() => {
    const out = new Map<
      string,
      Array<{
        readonly id: string;
        readonly invoice_number: string | null;
        readonly installment_id: string | null;
        readonly amount_gross: number;
        readonly status: string;
      }>
    >();
    for (const inv of invoices ?? []) {
      if (inv.sale_id == null) continue;
      const shaped = {
        id: inv.id,
        invoice_number: inv.invoice_number,
        installment_id: inv.installment_id,
        amount_gross: Number(inv.amount_gross),
        status: inv.status,
      };
      const arr = out.get(inv.sale_id);
      if (arr) arr.push(shaped);
      else out.set(inv.sale_id, [shaped]);
    }
    return out;
  }, [invoices]);

  const today = todayInAR();

  const overdueBySale = useMemo(() => {
    const out = new Map<string, SaleOverdueSummary>();
    for (const s of sales) {
      const insts = installmentsBySaleId.get(s.id) ?? [];
      const paysForSale = paymentsBySaleId.get(s.id) ?? [];
      const { normalized: normalizedPays } = normalizePaymentsForSaleCurrency(
        s,
        paysForSale,
        fxLookup,
      );
      const statuses = computeInstallmentStatuses(
        insts,
        normalizedPays,
        s.grace_days,
        today,
      );
      out.set(s.id, summarizeSaleOverdue(statuses));
    }
    return out;
  }, [sales, installmentsBySaleId, paymentsBySaleId, today]);

  const rankBySaleId = useMemo(
    () => buildSaleRanks(sales as unknown as SaleRow[]),
    [sales],
  );

  const paymentsSorted = useMemo(
    () => [...payments].sort((a, b) => a.paid_at.localeCompare(b.paid_at)),
    [payments],
  );
  // Acumulado por venta: si TODOS los cobros de la venta comparten moneda
  // con el sale, acumulamos en esa moneda nativa. Si hay mismatch, cambiamos
  // a USD (usando fxLookup) para no sumar pesos + dólares como si fuesen la
  // misma unidad — mismo criterio que la columna "Cobrado" de SalesTable.
  const accumByPaymentId = useMemo(() => {
    const out = new Map<
      string,
      { amount: number; currency: Currency; mixed: boolean }
    >();
    // Pre-computamos por venta si hay mismatch de moneda entre sus payments.
    const salePaymentsMap = new Map<string, PaymentRow[]>();
    for (const p of paymentsSorted) {
      const arr = salePaymentsMap.get(p.sale_id) ?? [];
      arr.push(p);
      salePaymentsMap.set(p.sale_id, arr);
    }
    const saleMixed = new Map<string, boolean>();
    const saleCurrencyMap = new Map<string, Currency>();
    for (const [saleId, pays] of salePaymentsMap) {
      const saleCurrency: Currency =
        fxLookup?.bySaleId[saleId]?.currency ?? "ARS";
      saleCurrencyMap.set(saleId, saleCurrency);
      let mixed = false;
      if (fxLookup) {
        for (const p of pays) {
          const c = fxLookup.byPaymentId[p.id]?.currency ?? saleCurrency;
          if (c !== saleCurrency) {
            mixed = true;
            break;
          }
        }
      }
      saleMixed.set(saleId, mixed);
    }
    const running = new Map<string, number>();
    for (const p of paymentsSorted) {
      const saleCurrency = saleCurrencyMap.get(p.sale_id) ?? "ARS";
      const mixed = saleMixed.get(p.sale_id) ?? false;
      let delta: number;
      let currency: Currency;
      if (mixed && fxLookup) {
        delta = fxLookup.byPaymentId[p.id]?.amountUsd ?? 0;
        currency = "USD";
      } else {
        delta = Number(p.amount) || 0;
        currency = saleCurrency;
      }
      const next = (running.get(p.sale_id) ?? 0) + delta;
      running.set(p.sale_id, next);
      out.set(p.id, { amount: next, currency, mixed });
    }
    return out;
  }, [paymentsSorted, fxLookup]);

  const installmentById = useMemo(
    () => new Map(installments.map((i) => [i.id, i])),
    [installments],
  );

  const normalizedQuery = filters.query.trim().toLowerCase();

  function saleMatches(sale: SaleRow): boolean {
    const lead = leadById.get(sale.lead_id);
    if (!lead) return false;

    if (normalizedQuery && !lead.name.toLowerCase().includes(normalizedQuery)) {
      return false;
    }

    if (filters.launchId !== "all") {
      if (filters.launchId === UNASSIGNED_LAUNCH) {
        if (sale.launch_id !== null) return false;
      } else if (sale.launch_id !== filters.launchId) {
        return false;
      }
    }

    if (filters.closerId !== "all") {
      const ownerId = lead.team_member_id;
      if (filters.closerId === "unassigned") {
        if (ownerId !== null) return false;
      } else if (ownerId !== filters.closerId) {
        return false;
      }
    }

    if (
      filters.modalityId !== "all" &&
      sale.payment_modality_id !== filters.modalityId
    ) {
      return false;
    }

    if (filters.productId !== "all" && sale.product_id !== filters.productId) {
      return false;
    }

    if (filters.collection !== "all") {
      const salePayments = paymentsBySaleId.get(sale.id) ?? [];
      const status = classifySaleStatus(sale, salePayments, fxLookup);
      if (status !== filters.collection) return false;
    }

    return true;
  }

  const filteredSales = useMemo(
    () => sales.filter(saleMatches),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sales, filters, leadById, paymentsBySaleId, fxLookup],
  );
  const filteredSaleIds = useMemo(
    () => new Set(filteredSales.map((s) => s.id)),
    [filteredSales],
  );

  const filteredPayments = useMemo(
    () =>
      payments
        .filter((p) => filteredSaleIds.has(p.sale_id))
        .sort((a, b) => b.paid_at.localeCompare(a.paid_at)),
    [payments, filteredSaleIds],
  );

  const filtersActive =
    filters.query !== "" ||
    filters.launchId !== "all" ||
    filters.closerId !== "all" ||
    filters.modalityId !== "all" ||
    filters.productId !== "all" ||
    filters.collection !== "all";

  const hasUnassignedLaunch = sales.some((s) => s.launch_id === null);

  const closersInSales = useMemo(() => {
    const ids = new Set<string>();
    for (const s of sales) {
      const ownerId = leadById.get(s.lead_id)?.team_member_id ?? null;
      if (ownerId) ids.add(ownerId);
    }
    return teamMembers.filter((m) => ids.has(m.id));
  }, [sales, leadById, teamMembers]);

  const hasUnassignedSales = sales.some(
    (s) => (leadById.get(s.lead_id)?.team_member_id ?? null) === null,
  );

  /** Filtros con valor distinto al default — alimenta el badge de "Filtros". */
  const activeFilterCount =
    (filters.query !== "" ? 1 : 0) +
    (filters.launchId !== "all" ? 1 : 0) +
    (filters.closerId !== "all" ? 1 : 0) +
    (filters.modalityId !== "all" ? 1 : 0) +
    (filters.productId !== "all" ? 1 : 0) +
    (filters.collection !== "all" ? 1 : 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/*
        Los filtros ya no se dibujan arriba de las tablas: `KgPageFilters` los
        registra en el drawer (desktop) / bottom-sheet (mobile) del botón
        "Filtros" del ContextBar y devuelve null. El motivo es alto vertical —
        la franja de 1 input + 5 selects se comía la primera pantalla y esta
        vista tiene DOS tablas apiladas.
      */}
      <KgPageFilters activeCount={activeFilterCount}>
        <CobrosFilters
          filters={filters}
          onChange={setFilters}
          searchKey={searchKey}
          onClear={() => {
            setFilters(EMPTY_FILTERS);
            setSearchKey((k) => k + 1);
          }}
          launches={launches}
          closers={closersInSales}
          modalities={modalities}
          products={products}
          hasUnassignedLaunch={hasUnassignedLaunch}
          hasUnassignedSales={hasUnassignedSales}
          totalSalesCount={sales.length}
          filteredSalesCount={filteredSales.length}
          filtersActive={filtersActive}
        />
      </KgPageFilters>

      <SalesTable
        sales={filteredSales}
        leadById={leadById}
        collectedBySale={collectedBySale}
        overdueBySale={overdueBySale}
        installmentsBySaleId={installmentsBySaleId}
        invoicesBySaleId={invoicesBySaleId}
        paymentsBySaleId={paymentsBySaleId}
        rankBySaleId={rankBySaleId}
        modalities={modalities}
        products={products}
        rules={rules}
        paymentMethods={paymentMethods}
        teamMembers={teamMembers}
        launches={launches}
        canEdit={canEdit}
        fxLookup={fxLookup}
        methodCurrencies={methodCurrencies}
        filtersActive={filtersActive}
        totalSalesCount={sales.length}
        createSaleAction={createSaleAction}
        addPaymentAction={addPaymentAction}
        deletePaymentAction={deletePaymentAction}
        deleteSaleAction={deleteSaleAction}
        updateSaleProductAction={updateSaleProductAction}
        recalculateSaleAction={recalculateSaleAction}
        updateSaleAction={updateSaleAction}
        updatePaymentInstallmentAction={updatePaymentInstallmentAction}
        updatePaymentMethodAction={updatePaymentMethodAction}
        assignLeadOwnerAction={assignLeadOwnerAction}
        hideCommission={hideCommission}
      />

      <PaymentsTable
        payments={filteredPayments}
        salesById={new Map(sales.map((s) => [s.id, s]))}
        leadById={leadById}
        modalityById={modalityById}
        productById={productById}
        installmentById={installmentById}
        paymentMethodById={paymentMethodById}
        accumByPaymentId={accumByPaymentId}
        canEdit={canEdit}
        fxLookup={fxLookup}
        filtersActive={filtersActive}
        totalPaymentsCount={payments.length}
        deletePaymentAction={deletePaymentAction}
      />
    </div>
  );
}

// ─── Filtros (viven en el drawer de página) ───────────────────────────────

/**
 * Pills del estado de cobro. `RangePills` usa el propio string como label y
 * como value, así que el mapa traduce pill ↔ `CollectionStatus` sin tocar el
 * contrato del filtro (`saleMatches` sigue leyendo `all|paid|partial|unpaid`).
 */
const COLLECTION_PILLS = ["Todas", "Cobrada", "Parcial", "Sin cobrar"] as const;
type CollectionPill = (typeof COLLECTION_PILLS)[number];
const PILL_TO_COLLECTION: Record<CollectionPill, CollectionStatus> = {
  Todas: "all",
  Cobrada: "paid",
  Parcial: "partial",
  "Sin cobrar": "unpaid",
};
const COLLECTION_TO_PILL: Record<CollectionStatus, CollectionPill> = {
  all: "Todas",
  paid: "Cobrada",
  partial: "Parcial",
  unpaid: "Sin cobrar",
};

/**
 * Bloque de filtros del drawer.
 *
 * POR QUÉ NO USA `KgFilterSelect`
 * Esa primitiva es URL-first: cada opción lleva un `href` y elegir dispara
 * `router.push`. Los filtros de esta vista NO viven en la URL — la page trae
 * TODAS las ventas/cobros del launch y el filtrado es en memoria, instantáneo.
 * Moverlos a la URL convertiría cada tecla y cada cambio de select en una
 * navegación con re-render del server component (refetch completo del dataset)
 * y en una entrada de historial. Por eso acá se replica el look exacto de
 * `KgFilterSelect` con un `value`/`onChange` local. Ver reporte de migración.
 */
function CobrosFilters({
  filters,
  onChange,
  searchKey,
  onClear,
  launches,
  closers,
  modalities,
  products,
  hasUnassignedLaunch,
  hasUnassignedSales,
  totalSalesCount,
  filteredSalesCount,
  filtersActive,
}: {
  readonly filters: FilterState;
  readonly onChange: (next: FilterState) => void;
  readonly searchKey: number;
  readonly onClear: () => void;
  /** Omitido = vista single-launch (sin dropdown de launch). */
  readonly launches?: ReadonlyArray<{ id: string; name: string }>;
  readonly closers: ReadonlyArray<Pick<TeamMemberRow, "id" | "name" | "active">>;
  readonly modalities: ReadonlyArray<PaymentModalityRow>;
  readonly products: ReadonlyArray<ProductRow>;
  readonly hasUnassignedLaunch: boolean;
  readonly hasUnassignedSales: boolean;
  readonly totalSalesCount: number;
  readonly filteredSalesCount: number;
  readonly filtersActive: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}
      >
        <label
          htmlFor="cobros-buscar"
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", fontWeight: 600 }}
        >
          Buscar
        </label>
        {/*
          Input NO controlado a propósito. El nodo de filtros se registra en el
          sheet vía efecto: si el value viviera en el estado del padre, cada
          tecla re-registraría el grupo entero y el <input> del sheet quedaría
          un commit detrás del DOM (lo aprendimos migrando leads). Sin `value`,
          el browser maneja el tipeo y el `onChange` sólo empuja el filtro.
          La `key` lo remonta cuando "Limpiar" resetea los filtros desde afuera.
        */}
        <input
          key={`cobros-buscar-${searchKey}`}
          id="cobros-buscar"
          type="search"
          className="kg-focus"
          placeholder="Nombre del alumno…"
          defaultValue={filters.query}
          onChange={(e) => onChange({ ...filters, query: e.target.value })}
          aria-label="Buscar alumno"
          style={filterFieldStyle}
        />
      </div>

      {launches && (
        <FilterSelect
          id="cobros-launch"
          label="Lanzamiento"
          value={filters.launchId}
          onChange={(v) => onChange({ ...filters, launchId: v })}
          options={[
            { value: "all", label: "Todos los lanzamientos" },
            ...(hasUnassignedLaunch
              ? [{ value: UNASSIGNED_LAUNCH, label: "Sin launch" }]
              : []),
            ...launches.map((l) => ({ value: l.id, label: l.name })),
          ]}
        />
      )}

      <FilterSelect
        id="cobros-closer"
        label="Closer"
        value={filters.closerId}
        onChange={(v) => onChange({ ...filters, closerId: v })}
        options={[
          { value: "all", label: "Todos los closers" },
          ...(hasUnassignedSales
            ? [{ value: "unassigned", label: "Sin asignar" }]
            : []),
          ...closers.map((c) => ({
            value: c.id,
            label: `${c.name}${c.active ? "" : " (inactivo)"}`,
          })),
        ]}
      />

      <FilterSelect
        id="cobros-modalidad"
        label="Modalidad"
        value={filters.modalityId}
        onChange={(v) => onChange({ ...filters, modalityId: v })}
        options={[
          { value: "all", label: "Todas las modalidades" },
          ...modalities.map((m) => ({ value: m.id, label: m.name })),
        ]}
      />

      <FilterSelect
        id="cobros-producto"
        label="Producto"
        value={filters.productId}
        onChange={(v) => onChange({ ...filters, productId: v })}
        options={[
          { value: "all", label: "Todos los productos" },
          ...products.map((p) => ({
            value: p.id,
            label: `${p.name}${p.active ? "" : " (inactivo)"}`,
          })),
        ]}
      />

      <div
        style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}
      >
        <span
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", fontWeight: 600 }}
        >
          Estado de cobro
        </span>
        {/* Sólo 4 opciones cortas y mutuamente excluyentes → pills, no select.
            El wrapper scrollea en 390px para que no desborde el sheet. */}
        <div style={{ overflowX: "auto", maxWidth: "100%" }}>
          <RangePills
            options={COLLECTION_PILLS}
            value={COLLECTION_TO_PILL[filters.collection]}
            onChange={(next) =>
              onChange({ ...filters, collection: PILL_TO_COLLECTION[next] })
            }
          />
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          paddingTop: 4,
          borderTop: "1px solid var(--kg-border-subtle)",
        }}
      >
        <span
          className="kg-t7 kg-num"
          style={{ color: "var(--kg-text-3)" }}
        >
          {filtersActive
            ? `${filteredSalesCount} de ${totalSalesCount} ventas`
            : `${totalSalesCount} ventas`}
        </span>
        {filtersActive && (
          <button
            type="button"
            onClick={onClear}
            className="kg-focus"
            style={{
              background: "none",
              border: "none",
              padding: 2,
              fontSize: 11,
              fontWeight: 700,
              color: "var(--kg-accent-text)",
              cursor: "pointer",
            }}
          >
            Limpiar
          </button>
        )}
      </div>
    </div>
  );
}

/** Campo de texto del drawer. Mismo look que el <select> de abajo. */
const filterFieldStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  padding: "8px 12px",
  borderRadius: "var(--kg-r-8)",
  background: "var(--kg-surface-2-solid)",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-1)",
  fontSize: 12,
  fontWeight: 600,
  colorScheme: "dark",
};

/**
 * Clon local de `KgFilterSelect` con `value`/`onChange` en vez de `href`.
 * Idéntico visualmente; ver la nota de `CobrosFilters` sobre por qué esta
 * vista no puede usar la primitiva URL-first.
 */

// ─── Sales table (Fase 11) ───────────────────────────────────────────────

function SalesTable({
  sales,
  leadById,
  collectedBySale,
  overdueBySale,
  installmentsBySaleId,
  invoicesBySaleId,
  paymentsBySaleId,
  rankBySaleId,
  modalities,
  products,
  rules,
  paymentMethods,
  teamMembers,
  launches,
  canEdit,
  fxLookup,
  methodCurrencies,
  filtersActive,
  totalSalesCount,
  createSaleAction,
  addPaymentAction,
  deletePaymentAction,
  deleteSaleAction,
  updateSaleProductAction,
  recalculateSaleAction,
  updateSaleAction,
  updatePaymentInstallmentAction,
  updatePaymentMethodAction,
  assignLeadOwnerAction,
  hideCommission = false,
}: {
  readonly sales: ReadonlyArray<SaleRow>;
  readonly leadById: ReadonlyMap<string, LeadForCobros>;
  readonly collectedBySale: ReadonlyMap<string, number>;
  readonly overdueBySale: ReadonlyMap<string, SaleOverdueSummary>;
  readonly installmentsBySaleId: ReadonlyMap<string, ReadonlyArray<InstallmentRow>>;
  readonly invoicesBySaleId: ReadonlyMap<
    string,
    ReadonlyArray<{
      readonly id: string;
      readonly invoice_number: string | null;
      readonly installment_id: string | null;
      readonly amount_gross: number;
      readonly status: string;
    }>
  >;
  readonly paymentsBySaleId: ReadonlyMap<string, ReadonlyArray<PaymentRow>>;
  readonly rankBySaleId: ReadonlyMap<string, number>;
  readonly modalities: ReadonlyArray<PaymentModalityRow>;
  readonly products: ReadonlyArray<ProductRow>;
  readonly rules: ReadonlyArray<CommissionRuleRow>;
  readonly paymentMethods: ReadonlyArray<PaymentMethodRow>;
  readonly launches?: ReadonlyArray<{ id: string; name: string }>;
  readonly teamMembers: ReadonlyArray<
    Pick<TeamMemberRow, "id" | "name" | "active" | "role">
  >;
  readonly canEdit: boolean;
  readonly fxLookup?: FxLookup;
  readonly methodCurrencies: Record<string, "ARS" | "USD">;
  readonly filtersActive: boolean;
  readonly totalSalesCount: number;
  readonly createSaleAction: CreateSaleAction;
  readonly addPaymentAction: AddPaymentAction;
  readonly deletePaymentAction: DeletePaymentAction;
  readonly deleteSaleAction: DeleteSaleAction;
  readonly updateSaleProductAction: UpdateSaleProductAction;
  readonly recalculateSaleAction: RecalculateSaleAction;
  readonly updateSaleAction: UpdateSaleAction;
  readonly updatePaymentInstallmentAction: UpdatePaymentInstallmentAction;
  readonly updatePaymentMethodAction: UpdatePaymentMethodAction;
  readonly assignLeadOwnerAction: AssignLeadOwnerAction;
  readonly hideCommission?: boolean;
}) {
  // Totales del footer: con fxCtx sumamos en USD (convierte cada sale/pay
  // según su moneda nativa). Sin fxCtx (vista legacy), suma simple.
  let totalPactado = 0;
  let totalCobrado = 0;
  let totalVencido = 0;
  let totalCuotasVencidas = 0;
  let missingCount = 0;
  for (const s of sales) {
    if (fxLookup) {
      const usdSale = fxLookup.bySaleId[s.id]?.totalUsd ?? null;
      if (usdSale === null) missingCount++;
      else totalPactado += usdSale;

      // Cobrado del sale: sumamos sus payments convertidos.
      const paysForSale = (paymentsBySaleId.get(s.id) ?? []) as ReadonlyArray<PaymentRow>;
      for (const p of paysForSale) {
        const usdPay = fxLookup.byPaymentId[p.id]?.amountUsd ?? null;
        if (usdPay === null) missingCount++;
        else totalCobrado += usdPay;
      }
      // El vencido tal cual (mismo criterio de moneda del sale) — es una
      // cifra derivada del `overdueAmount` que viene en la moneda nativa
      // del sale. Convertimos con la tasa del sale para mantenerlo en USD.
      const od = overdueBySale.get(s.id);
      if (od && od.overdueAmount > 0) {
        if (usdSale !== null && (Number(s.total_amount) || 0) > 0) {
          totalVencido +=
            (od.overdueAmount * usdSale) / (Number(s.total_amount) || 1);
        }
      }
      if (od) totalCuotasVencidas += od.overdueCount;
    } else {
      totalPactado += Number(s.total_amount) || 0;
      totalCobrado += collectedBySale.get(s.id) ?? 0;
      const od = overdueBySale.get(s.id);
      if (od) {
        totalVencido += od.overdueAmount;
        totalCuotasVencidas += od.overdueCount;
      }
    }
  }

  const fmtRowMoney = fxLookup
    ? (amount: number, saleId: string): string =>
        fmtNative(amount, fxLookup.bySaleId[saleId]?.currency ?? "USD")
    : (amount: number, _saleId: string): string => fmtMoney(amount);

  const fmtTotalMoney = fxLookup ? fmtUsd : fmtMoney;

  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const visibleIds = useMemo(() => sales.map((s) => s.id), [sales]);
  const visibleIdSet = useMemo(() => new Set(visibleIds), [visibleIds]);
  /**
   * La selección se DERIVA en render intersectándola con lo visible: si un
   * filtro esconde una venta marcada, su id no viaja a la server action. No
   * hace falta el patrón `{key: searchParams, ids}` de `leads-table` porque
   * acá los filtros son estado local y no navegan — pero la regla es la
   * misma: nada de resetear con un `useEffect`.
   */
  const effectiveSelected = useMemo(() => {
    if (selectedIds.size === 0) return selectedIds;
    const next = new Set<string>();
    for (const id of selectedIds) if (visibleIdSet.has(id)) next.add(id);
    return next;
  }, [selectedIds, visibleIdSet]);

  /** Datos del lead que consume `SaleModal`. Sin cambios respecto de antes. */
  function leadForModalOf(
    s: SaleRow,
  ): Pick<LeadRow, "id" | "name" | "launch_id" | "team_member_id"> {
    const lead = leadById.get(s.lead_id);
    return lead
      ? {
          id: lead.id,
          name: lead.name,
          launch_id: lead.launch_id,
          team_member_id: lead.team_member_id,
        }
      : {
          id: s.lead_id,
          name: "—",
          launch_id: null,
          team_member_id: s.team_member_id,
        };
  }

  /** Props del SaleModal comunes a los dos triggers de la fila. */
  function saleModalProps(s: SaleRow) {
    const leadForModal = leadForModalOf(s);
    return {
      lead: leadForModal,
      sales: [s],
      saleRanks: rankBySaleId,
      paymentsBySaleId: new Map([[s.id, paymentsBySaleId.get(s.id) ?? []]]),
      installmentsBySaleId: new Map([
        [s.id, installmentsBySaleId.get(s.id) ?? []],
      ]),
      initialSaleId: s.id,
      allowCreateAnother: false,
      modalities,
      products,
      rules,
      paymentMethods,
      teamMembers,
      launches,
      createSaleAction: createSaleAction.bind(null, leadForModal.id),
      updateProductAction: (saleId: string, productId: string) =>
        updateSaleProductAction(saleId, productId),
      recalculateAction: recalculateSaleAction,
      updateSaleAction,
      addPaymentAction,
      deletePaymentAction,
      deleteSaleAction,
      updatePaymentInstallmentAction,
      updatePaymentMethodAction,
      assignLeadOwnerAction: canEdit ? assignLeadOwnerAction : undefined,
      methodCurrencies,
      hideCommission,
    };
  }

  const cargarCobroColumn: Column<SaleRow> = {
    key: "cargar",
    label: (
      <span title="Cargar un cobro rápido. Para ver el historial completo, tocá el nombre del alumno.">
        Cargar cobro
      </span>
    ),
    align: "right",
    render: (s) => {
      const lead = leadById.get(s.lead_id);
      return (
        // `triggerStyle` (agregado por la migración de SaleModal) permite
        // expresar el botón con vars KG en vez de clases de tokens viejos.
        <SaleModal
          {...saleModalProps(s)}
          triggerLabel="+"
          triggerAriaLabel={`Cargar cobro a ${lead?.name ?? "alumno"}`}
          triggerStyle={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            // 28px de lado: el mínimo cómodo para el pulgar en 390px.
            width: 28,
            height: 28,
            borderRadius: "var(--kg-r-8)",
            border: "1px solid var(--kg-border-accent)",
            background: "var(--kg-accent-halo)",
            color: "var(--kg-accent-text)",
            fontSize: 15,
            fontWeight: 700,
            lineHeight: 1,
            cursor: "pointer",
          }}
          variant="add-payment"
        />
      );
    },
  };

  const columns: ReadonlyArray<Column<SaleRow>> = [
    {
      key: "alumno",
      label: "Alumno",
      render: (s) => {
        const lead = leadById.get(s.lead_id);
        return (
          <SaleModal
            {...saleModalProps(s)}
            invoicesBySaleId={
              new Map([[s.id, invoicesBySaleId.get(s.id) ?? []]])
            }
            fxLookup={fxLookup}
            triggerLabel={lead?.name ?? "—"}
            triggerStyle={nameTriggerStyle}
            // El subrayado en hover es lo único que no se puede expresar con
            // estilos inline; el resto del look va en `triggerStyle`.
            triggerClassName="underline-offset-2 hover:underline"
          />
        );
      },
    },
    {
      key: "pactado",
      label: "Pactado",
      align: "right",
      numeric: true,
      render: (s) => fmtRowMoney(Number(s.total_amount) || 0, s.id),
    },
    {
      key: "cobrado",
      label: "Cobrado",
      align: "right",
      numeric: true,
      render: (s) => {
        const salePayments = paymentsBySaleId.get(s.id) ?? [];
        const saleCurrency: Currency =
          fxLookup?.bySaleId[s.id]?.currency ?? "ARS";
        const display = collectedForSale(saleCurrency, salePayments, fxLookup);
        return (
          <span style={numericCellStyle}>
            {fxLookup
              ? fmtNative(display.amount, display.currency)
              : fmtMoney(collectedBySale.get(s.id) ?? 0)}
            {display.mixed && (
              // El monto no se pinta: el aviso de moneda mezclada es un dot.
              <span
                title="Los cobros de esta venta están en moneda distinta al pactado. Se muestra el total convertido a USD."
                aria-label="Cobros en moneda distinta al pactado"
                style={{ display: "inline-flex" }}
              >
                <StateDot tone="warning" />
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: "vencido",
      label: "Vencido",
      align: "right",
      numeric: true,
      render: (s) => {
        const overdueAmount = overdueBySale.get(s.id)?.overdueAmount ?? 0;
        if (overdueAmount <= 0) return <Dash />;
        return (
          // Antes el monto vencido iba en rojo. La plata no se pinta: el rojo
          // se mudó al StateDot y el número queda en el color de la tabla.
          <span style={numericCellStyle} title="Monto vencido">
            {fmtRowMoney(overdueAmount, s.id)}
            <StateDot tone="negative" />
          </span>
        );
      },
    },
    {
      key: "cuotas",
      label: (
        <span title="Cantidad de cuotas cuyo vencimiento + gracia ya pasó y siguen con saldo">
          Cuotas venc.
        </span>
      ),
      align: "right",
      numeric: true,
      render: (s) => {
        const overdueCount = overdueBySale.get(s.id)?.overdueCount ?? 0;
        if (overdueCount <= 0) return <Dash />;
        return (
          <span style={numericCellStyle} title="Cuotas vencidas">
            {fmtNumber(overdueCount)}
            <StateDot tone="negative" />
          </span>
        );
      },
    },
    {
      key: "proximo",
      label: "Próx. vencimiento",
      render: (s) => {
        const salePayments = paymentsBySaleId.get(s.id) ?? [];
        const saleCurrency: Currency =
          fxLookup?.bySaleId[s.id]?.currency ?? "ARS";
        const display = collectedForSale(saleCurrency, salePayments, fxLookup);
        const total = Number(s.total_amount) || 0;
        // "Al día": con mismatch comparamos ambos en USD; sin mismatch, en la
        // moneda nativa. Nunca ARS crudo contra USD crudo (bug original).
        const paidUp = display.mixed
          ? (() => {
              const usdTotal = fxLookup?.bySaleId[s.id]?.totalUsd ?? null;
              return (
                usdTotal !== null && usdTotal > 0 && display.amount >= usdTotal
              );
            })()
          : total > 0 && display.amount >= total;
        if (paidUp) return <StatusPill text="Al día" tone={TONE_VAR.positive} />;
        const nextDue = overdueBySale.get(s.id)?.nextDueDate ?? null;
        return nextDue ? (
          <span style={{ color: "var(--kg-text-2)" }}>{fmtDate(nextDue)}</span>
        ) : (
          <Dash />
        );
      },
    },
    ...(canEdit ? [cargarCobroColumn] : []),
  ];

  return (
    <>
      <Panel title="Ventas cerradas" pad={false}>
        <KgDataTable
          columns={columns}
          rows={sales}
          rowKey={(s) => s.id}
          // Dos tablas conviven en esta página, así que `fillHeight` (que se
          // come todo el alto disponible) no aplica: cada una scrollea dentro
          // de un techo propio para que el <thead> y la fila de totales queden
          // sticky y el body de la página no crezca sin fin.
          maxBodyHeight="min(56vh, 620px)"
          emptyTitle={
            totalSalesCount === 0
              ? "Sin ventas en columna cerrado para este lanzamiento."
              : filtersActive
                ? "Ninguna venta coincide con los filtros aplicados."
                : "Sin ventas."
          }
          emptyHint={
            filtersActive && totalSalesCount > 0
              ? "Ajustá o limpiá los filtros desde el botón Filtros."
              : undefined
          }
          selection={
            canEdit
              ? {
                  selectedIds: effectiveSelected,
                  onToggleRow: (id, selected) =>
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      if (selected) next.add(id);
                      else next.delete(id);
                      return next;
                    }),
                  onToggleAll: (selected, ids) =>
                    setSelectedIds(selected ? new Set(ids) : new Set()),
                  headerLabel: "Seleccionar todas las ventas visibles",
                  rowLabel: (s) =>
                    `Seleccionar venta de ${leadById.get(s.lead_id)?.name ?? "sin alumno"}`,
                }
              : undefined
          }
          totalsRow={{
            label: filtersActive
              ? `Subtotal filtrado · ${sales.length} venta${sales.length === 1 ? "" : "s"}`
              : `Total · ${sales.length} venta${sales.length === 1 ? "" : "s"}`,
            // Cubre sólo "Alumno": la columna del checkbox la suma la tabla.
            labelSpan: 1,
            cells: {
              pactado: fmtTotalMoney(totalPactado),
              cobrado: fmtTotalMoney(totalCobrado),
              vencido:
                totalVencido > 0 ? (
                  // Igual que en la fila: el total vencido dejó de ser rojo.
                  <span style={numericCellStyle} title="Total vencido">
                    {fmtTotalMoney(totalVencido)}
                    <StateDot tone="negative" />
                  </span>
                ) : (
                  "—"
                ),
              cuotas:
                totalCuotasVencidas > 0 ? (
                  <span style={numericCellStyle} title="Total de cuotas vencidas">
                    {fmtNumber(totalCuotasVencidas)}
                    <StateDot tone="negative" />
                  </span>
                ) : (
                  "—"
                ),
            },
          }}
        />
      </Panel>

      {/*
        `KgSelectionBar` se portalea sola a `body` (ver `kg/selection-bar.tsx`):
        la tabla vive dentro de un `Panel` con `backdrop-filter`, que en tema
        oscuro sería containing block de cualquier `position: fixed` adentro.
      */}
      {canEdit && effectiveSelected.size > 0 && (
        <BulkAssignBar
          selectedCount={effectiveSelected.size}
          selectedIds={Array.from(effectiveSelected)}
          products={products}
          updateSaleProductAction={updateSaleProductAction}
          onClear={() => setSelectedIds(new Set())}
        />
      )}
    </>
  );
}

/**
 * Trigger del nombre del alumno: se lee como texto de la celda, no como
 * botón. El subrayado sólo aparece en hover (vía clase, ver call site).
 */
const nameTriggerStyle: CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  // La tipografía la hereda del <td> (el reset del repo pone `font: inherit`
  // en los botones); acá sólo se refuerza el peso del nombre.
  fontWeight: 600,
  color: "var(--kg-text-1)",
  textAlign: "left",
  cursor: "pointer",
};

/** Celda numérica con un dot de estado al lado del número (nunca encima). */
const numericCellStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 6,
};

/** Placeholder gris para celdas sin valor. */
function Dash() {
  return <span style={{ color: "var(--kg-text-3)" }}>—</span>;
}

// ─── Payments table ───────────────────────────────────────────────────────

function PaymentsTable({
  payments,
  salesById,
  leadById,
  modalityById,
  productById,
  installmentById,
  paymentMethodById,
  accumByPaymentId,
  canEdit,
  fxLookup,
  filtersActive,
  totalPaymentsCount,
  deletePaymentAction,
}: {
  readonly payments: ReadonlyArray<PaymentRow>;
  readonly salesById: ReadonlyMap<string, SaleRow>;
  readonly leadById: ReadonlyMap<string, LeadForCobros>;
  readonly modalityById: ReadonlyMap<string, PaymentModalityRow>;
  readonly productById: ReadonlyMap<string, ProductRow>;
  readonly installmentById: ReadonlyMap<string, InstallmentRow>;
  readonly paymentMethodById: ReadonlyMap<string, PaymentMethodRow>;
  readonly accumByPaymentId: ReadonlyMap<
    string,
    { amount: number; currency: Currency; mixed: boolean }
  >;
  readonly canEdit: boolean;
  readonly fxLookup?: FxLookup;
  readonly filtersActive: boolean;
  readonly totalPaymentsCount: number;
  readonly deletePaymentAction: DeletePaymentAction;
}) {
  // Con fxLookup: total en USD (convierte cada payment). Sin fxLookup: suma cruda.
  let totalMonto = 0;
  for (const p of payments) {
    if (fxLookup) {
      const usd = fxLookup.byPaymentId[p.id]?.amountUsd ?? null;
      if (usd !== null) totalMonto += usd;
    } else {
      totalMonto += Number(p.amount) || 0;
    }
  }

  const fmtRowPay = fxLookup
    ? (p: PaymentRow, amount: number): string =>
        fmtNative(amount, fxLookup.byPaymentId[p.id]?.currency ?? "USD")
    : (_p: PaymentRow, amount: number): string => fmtMoney(amount);
  const fmtTotal = fxLookup ? fmtUsd : fmtMoney;

  const accionesColumn: Column<PaymentRow> = {
    key: "acciones",
    label: "Acciones",
    align: "right",
    render: (p) => (
      <DeletePaymentButton
        paymentId={p.id}
        amount={Number(p.amount)}
        deletePaymentAction={deletePaymentAction}
      />
    ),
  };

  const columns: ReadonlyArray<Column<PaymentRow>> = [
    {
      key: "fecha",
      label: "Fecha",
      render: (p) => (
        <span className="kg-num" style={{ color: "var(--kg-text-2)" }}>
          {fmtDate(p.paid_at)}
        </span>
      ),
    },
    {
      key: "alumno",
      label: "Alumno",
      render: (p) => {
        const sale = salesById.get(p.sale_id);
        const lead = sale ? leadById.get(sale.lead_id) : null;
        return <span style={{ fontWeight: 600 }}>{lead?.name ?? "—"}</span>;
      },
    },
    {
      key: "producto",
      label: "Producto",
      render: (p) => {
        const sale = salesById.get(p.sale_id);
        const product = sale ? productById.get(sale.product_id) : null;
        return product?.name ?? <Dash />;
      },
    },
    {
      key: "modalidad",
      label: "Modalidad",
      render: (p) => {
        const sale = salesById.get(p.sale_id);
        const modality = sale
          ? modalityById.get(sale.payment_modality_id)
          : null;
        return modality?.name ?? <Dash />;
      },
    },
    {
      key: "cuota",
      label: "Cuota #",
      render: (p) => {
        const inst = p.installment_id
          ? (installmentById.get(p.installment_id) ?? null)
          : null;
        // El "sin cuota" era texto ámbar; ahora es un pill con dot (el texto
        // queda neutro, el color vive sólo en el punto).
        return inst ? (
          `Cuota ${inst.number}`
        ) : (
          <StatusPill text="Sin cuota" tone={TONE_VAR.warning} />
        );
      },
    },
    {
      key: "metodo",
      label: "Método",
      render: (p) => {
        const method = p.payment_method_id
          ? (paymentMethodById.get(p.payment_method_id) ?? null)
          : null;
        return method ? (
          method.name
        ) : (
          <StatusPill text="Sin método" tone={TONE_VAR.warning} />
        );
      },
    },
    {
      key: "monto",
      label: "Monto",
      align: "right",
      numeric: true,
      render: (p) => fmtRowPay(p, Number(p.amount)),
    },
    {
      key: "acumulado",
      label: "Acumulado venta",
      align: "right",
      numeric: true,
      render: (p) => {
        const acc = accumByPaymentId.get(p.id);
        if (!acc) return fmtRowPay(p, 0);
        if (!fxLookup) return fmtMoney(acc.amount);
        return (
          <span style={numericCellStyle}>
            {fmtNative(acc.amount, acc.currency)}
            {acc.mixed && (
              <span
                title="La venta tiene cobros en más de una moneda. El acumulado se muestra convertido a USD."
                aria-label="Venta con cobros en más de una moneda"
                style={{ display: "inline-flex" }}
              >
                <StateDot tone="warning" />
              </span>
            )}
          </span>
        );
      },
    },
    ...(canEdit ? [accionesColumn] : []),
  ];

  return (
    <Panel
      title="Historial de cobros"
      pad={false}
      actions={
        filtersActive ? (
          <span className="kg-t7 kg-num" style={{ color: "var(--kg-text-3)" }}>
            {payments.length} de {totalPaymentsCount} cobros
          </span>
        ) : undefined
      }
    >
      <KgDataTable
        columns={columns}
        rows={payments}
        rowKey={(p) => p.id}
        maxBodyHeight="min(56vh, 620px)"
        emptyTitle={
          totalPaymentsCount === 0
            ? "Sin cobros registrados todavía."
            : filtersActive
              ? "Ningún cobro coincide con los filtros aplicados."
              : "Sin cobros."
        }
        emptyHint={
          totalPaymentsCount === 0
            ? "Usá el botón + de la tabla de ventas para cargar el primero."
            : filtersActive
              ? "Ajustá o limpiá los filtros desde el botón Filtros."
              : undefined
        }
        totalsRow={{
          label: filtersActive
            ? `Subtotal filtrado · ${payments.length} cobro${payments.length === 1 ? "" : "s"}`
            : `Total · ${payments.length} cobro${payments.length === 1 ? "" : "s"}`,
          // Cubre Fecha → Método: el total sólo aplica a la columna "Monto".
          labelSpan: 6,
          cells: { monto: fmtTotal(totalMonto) },
        }}
      />
    </Panel>
  );
}

function DeletePaymentButton({
  paymentId,
  amount,
  deletePaymentAction,
}: {
  readonly paymentId: string;
  readonly amount: number;
  readonly deletePaymentAction: DeletePaymentAction;
}) {
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        if (!confirm(`¿Borrar cobro de ${fmtMoney(amount)}?`)) return;
        setPending(true);
        try {
          await deletePaymentAction(paymentId);
        } finally {
          setPending(false);
        }
      }}
      aria-label="Borrar cobro"
      className="kg-focus"
      style={{
        ...dangerBtn,
        padding: "3px 10px",
        opacity: pending ? 0.5 : 1,
        cursor: pending ? "wait" : "pointer",
      }}
    >
      {pending ? "…" : "×"}
    </button>
  );
}

function BulkAssignBar({
  selectedCount,
  selectedIds,
  products,
  updateSaleProductAction,
  onClear,
}: {
  readonly selectedCount: number;
  readonly selectedIds: ReadonlyArray<string>;
  readonly products: ReadonlyArray<ProductRow>;
  readonly updateSaleProductAction: UpdateSaleProductAction;
  readonly onClear: () => void;
}) {
  const [productId, setProductId] = useState<string>("");
  const [regenerate, setRegenerate] = useState(false);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{
    ok: number;
    fail: number;
    firstError?: string;
  } | null>(null);
  const activeProducts = products.filter((p) => p.active);

  async function apply() {
    if (!productId) return;
    setPending(true);
    setFeedback(null);
    try {
      const results = await Promise.allSettled(
        selectedIds.map((id) =>
          updateSaleProductAction(id, productId, regenerate),
        ),
      );
      let ok = 0;
      let fail = 0;
      let firstError: string | undefined;
      for (const r of results) {
        if (r.status === "fulfilled") {
          if ("ok" in r.value) ok++;
          else {
            fail++;
            firstError ??= r.value.error;
          }
        } else {
          fail++;
          firstError ??= "Error de red";
        }
      }
      setFeedback({ ok, fail, firstError });
      if (fail === 0) {
        onClear();
        setProductId("");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <KgSelectionBar
      count={selectedCount}
      noun={selectedCount === 1 ? "venta" : "ventas"}
      onClear={pending ? undefined : onClear}
      message={
        feedback && (
          <span
            style={{
              // Pintar un MENSAJE sí está permitido — lo que no se pinta es
              // la plata. Éste es el resultado de la última acción masiva.
              color:
                feedback.fail === 0 ? "var(--kg-text-3)" : TONE_VAR.negative,
            }}
          >
            {feedback.fail === 0
              ? `${feedback.ok} venta${feedback.ok === 1 ? "" : "s"} actualizada${feedback.ok === 1 ? "" : "s"}.`
              : `${feedback.ok} OK · ${feedback.fail} con error${feedback.firstError ? ` (${feedback.firstError})` : ""}.`}
          </span>
        )
      }
    >
      <select
        value={productId}
        onChange={(e) => setProductId(e.target.value)}
        disabled={pending}
        aria-label="Producto a asignar en bulk"
        className="kg-focus"
        style={barControlStyle(pending)}
      >
        <option value="">Elegí producto…</option>
        {activeProducts.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      <label
        title="Actualizar comisión con la regla del nuevo producto"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          fontWeight: 600,
          color: "var(--kg-text-2)",
          cursor: pending ? "wait" : "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={regenerate}
          disabled={pending}
          onChange={(e) => setRegenerate(e.target.checked)}
          className="kg-focus"
          style={{ accentColor: "var(--kg-accent-500)" }}
        />
        Actualizar comisión
      </label>

      <button
        type="button"
        disabled={pending || !productId}
        onClick={apply}
        className="kg-focus"
        style={{
          ...primaryBtn,
          padding: "6px 14px",
          fontSize: 11,
          opacity: pending || !productId ? 0.5 : 1,
          cursor: pending ? "wait" : productId ? "pointer" : "default",
        }}
      >
        {pending ? "Asignando…" : "Asignar"}
      </button>
    </KgSelectionBar>
  );
}

/** Control (select / label) dentro de la KgSelectionBar. */
function barControlStyle(pending: boolean): CSSProperties {
  return {
    padding: "6px 12px",
    borderRadius: 999,
    background: "var(--kg-surface-2-solid)",
    border: "1px solid var(--kg-border-subtle)",
    color: "var(--kg-text-1)",
    fontSize: 11,
    fontWeight: 700,
    colorScheme: "dark",
    opacity: pending ? 0.6 : 1,
    cursor: pending ? "wait" : "pointer",
  };
}
