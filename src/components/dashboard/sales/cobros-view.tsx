"use client";

import { useMemo, useState } from "react";

import type {
  PaymentActionState,
  SaleActionState,
} from "@/app/(app)/proyectos/[projectId]/leads/sale-actions";
import { buildSaleRanks } from "@/lib/commissions/ranking";
import type {
  CommissionRuleRow,
  InstallmentRow,
  PaymentModalityRow,
  PaymentRow,
  SaleRow,
} from "@/lib/commissions/types";
import { fmtDate, fmtMoney, fmtNumber } from "@/lib/format";
import { fmtNative, fmtUsd, type FxLookup } from "@/lib/money";
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
 * Vista interactiva del tab Cobros. Fase 11: la tabla principal se reduce a
 * los KPIs "de cobro" (Pactado, Cobrado, Vencido, # Cuotas vencidas, Próx
 * vencimiento) y el detalle completo (closer, producto, modalidad, fecha
 * cierre, cronograma) vive en la ficha del alumno = SaleModal.
 */
export function CobrosView({
  sales,
  payments,
  installments,
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
}: {
  readonly sales: ReadonlyArray<SaleRow>;
  readonly payments: ReadonlyArray<PaymentRow>;
  readonly installments: ReadonlyArray<InstallmentRow>;
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
}) {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);

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

  const today = todayInAR();

  const overdueBySale = useMemo(() => {
    const out = new Map<string, SaleOverdueSummary>();
    for (const s of sales) {
      const insts = installmentsBySaleId.get(s.id) ?? [];
      const paysForSale = paymentsBySaleId.get(s.id) ?? [];
      const statuses = computeInstallmentStatuses(
        insts,
        paysForSale,
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
  const accumByPaymentId = useMemo(() => {
    const out = new Map<string, number>();
    const running = new Map<string, number>();
    for (const p of paymentsSorted) {
      const next = (running.get(p.sale_id) ?? 0) + Number(p.amount);
      running.set(p.sale_id, next);
      out.set(p.id, next);
    }
    return out;
  }, [paymentsSorted]);

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
      const collected = collectedBySale.get(sale.id) ?? 0;
      const total = Number(sale.total_amount) || 0;
      const status: CollectionStatus =
        collected <= 0
          ? "unpaid"
          : collected >= total
            ? "paid"
            : "partial";
      if (status !== filters.collection) return false;
    }

    return true;
  }

  const filteredSales = useMemo(
    () => sales.filter(saleMatches),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sales, filters, leadById, collectedBySale],
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

  return (
    <div className="space-y-6">
      <FilterBar
        filters={filters}
        onChange={setFilters}
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

      <SalesTable
        sales={filteredSales}
        leadById={leadById}
        collectedBySale={collectedBySale}
        overdueBySale={overdueBySale}
        installmentsBySaleId={installmentsBySaleId}
        paymentsBySaleId={paymentsBySaleId}
        rankBySaleId={rankBySaleId}
        modalities={modalities}
        products={products}
        rules={rules}
        paymentMethods={paymentMethods}
        teamMembers={teamMembers}
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

function FilterBar({
  filters,
  onChange,
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
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface/40 px-3 py-2">
      <input
        type="search"
        placeholder="Buscar por nombre del alumno…"
        value={filters.query}
        onChange={(e) => onChange({ ...filters, query: e.target.value })}
        className="min-w-[14rem] flex-1 rounded-md border border-border bg-bg-elevated px-2 py-1 text-sm text-fg placeholder:text-fg-subtle"
        aria-label="Buscar alumno"
      />
      {launches && (
        <select
          value={filters.launchId}
          onChange={(e) => onChange({ ...filters, launchId: e.target.value })}
          className="rounded-md border border-border bg-bg-elevated px-2 py-1 text-sm text-fg"
          aria-label="Filtrar por lanzamiento"
        >
          <option value="all">Todos los lanzamientos</option>
          {hasUnassignedLaunch && (
            <option value={UNASSIGNED_LAUNCH}>Sin launch</option>
          )}
          {launches.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      )}
      <select
        value={filters.closerId}
        onChange={(e) => onChange({ ...filters, closerId: e.target.value })}
        className="rounded-md border border-border bg-bg-elevated px-2 py-1 text-sm text-fg"
        aria-label="Filtrar por closer"
      >
        <option value="all">Todos los closers</option>
        {hasUnassignedSales && <option value="unassigned">Sin asignar</option>}
        {closers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {!c.active ? " (inactivo)" : ""}
          </option>
        ))}
      </select>
      <select
        value={filters.modalityId}
        onChange={(e) => onChange({ ...filters, modalityId: e.target.value })}
        className="rounded-md border border-border bg-bg-elevated px-2 py-1 text-sm text-fg"
        aria-label="Filtrar por modalidad"
      >
        <option value="all">Todas las modalidades</option>
        {modalities.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <select
        value={filters.productId}
        onChange={(e) => onChange({ ...filters, productId: e.target.value })}
        className="rounded-md border border-border bg-bg-elevated px-2 py-1 text-sm text-fg"
        aria-label="Filtrar por producto"
      >
        <option value="all">Todos los productos</option>
        {products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {!p.active ? " (inactivo)" : ""}
          </option>
        ))}
      </select>
      <select
        value={filters.collection}
        onChange={(e) =>
          onChange({ ...filters, collection: e.target.value as CollectionStatus })
        }
        className="rounded-md border border-border bg-bg-elevated px-2 py-1 text-sm text-fg"
        aria-label="Filtrar por estado de cobro"
      >
        <option value="all">Cualquier estado</option>
        <option value="paid">Cobrada</option>
        <option value="partial">Parcial</option>
        <option value="unpaid">Sin cobrar</option>
      </select>
      <span className="text-xs text-fg-subtle">
        {filtersActive
          ? `${filteredSalesCount} de ${totalSalesCount} ventas`
          : `${totalSalesCount} ventas`}
      </span>
      {filtersActive && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTERS)}
          className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg hover:bg-bg-elevated"
        >
          Limpiar
        </button>
      )}
    </div>
  );
}

// ─── Sales table (Fase 11) ───────────────────────────────────────────────

function SalesTable({
  sales,
  leadById,
  collectedBySale,
  overdueBySale,
  installmentsBySaleId,
  paymentsBySaleId,
  rankBySaleId,
  modalities,
  products,
  rules,
  paymentMethods,
  teamMembers,
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
}: {
  readonly sales: ReadonlyArray<SaleRow>;
  readonly leadById: ReadonlyMap<string, LeadForCobros>;
  readonly collectedBySale: ReadonlyMap<string, number>;
  readonly overdueBySale: ReadonlyMap<string, SaleOverdueSummary>;
  readonly installmentsBySaleId: ReadonlyMap<string, ReadonlyArray<InstallmentRow>>;
  readonly paymentsBySaleId: ReadonlyMap<string, ReadonlyArray<PaymentRow>>;
  readonly rankBySaleId: ReadonlyMap<string, number>;
  readonly modalities: ReadonlyArray<PaymentModalityRow>;
  readonly products: ReadonlyArray<ProductRow>;
  readonly rules: ReadonlyArray<CommissionRuleRow>;
  readonly paymentMethods: ReadonlyArray<PaymentMethodRow>;
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
  const effectiveSelected = useMemo(() => {
    if (selectedIds.size === 0) return selectedIds;
    const next = new Set<string>();
    for (const id of selectedIds) if (visibleIdSet.has(id)) next.add(id);
    return next;
  }, [selectedIds, visibleIdSet]);
  const allSelected =
    visibleIds.length > 0 && effectiveSelected.size === visibleIds.length;
  const someSelected =
    !allSelected && effectiveSelected.size > 0;

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleIds));
    }
  }
  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // 1 (checkbox opcional) + Alumno = 2 cols antes de los numéricos.
  const totalColSpan = canEdit ? 2 : 1;

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-fg">Ventas cerradas</h2>
      {canEdit && effectiveSelected.size > 0 && (
        <BulkAssignBar
          selectedCount={effectiveSelected.size}
          selectedIds={Array.from(effectiveSelected)}
          products={products}
          updateSaleProductAction={updateSaleProductAction}
          onClear={() => setSelectedIds(new Set())}
        />
      )}
      {sales.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-surface/40 p-8 text-center text-sm text-fg-muted">
          {totalSalesCount === 0
            ? "Sin ventas en columna cerrado para este lanzamiento."
            : filtersActive
              ? "Ninguna venta coincide con los filtros aplicados."
              : "Sin ventas."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="bg-surface text-left text-xs uppercase tracking-wide text-fg-subtle">
              <tr>
                {canEdit && (
                  <th className="w-8 px-3 py-3 font-medium">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someSelected;
                      }}
                      onChange={toggleAll}
                      aria-label="Seleccionar todas las ventas visibles"
                      className="accent-accent"
                    />
                  </th>
                )}
                <th className="px-3 py-3 font-medium">Alumno</th>
                <th className="px-3 py-3 text-right font-medium">Pactado</th>
                <th className="px-3 py-3 text-right font-medium">Cobrado</th>
                <th className="px-3 py-3 text-right font-medium">Vencido</th>
                <th
                  className="px-3 py-3 text-right font-medium"
                  title="Cantidad de cuotas cuyo vencimiento + gracia ya pasó y siguen con saldo"
                >
                  Cuotas venc.
                </th>
                <th className="px-3 py-3 font-medium">Próx. vencimiento</th>
                {canEdit && (
                  <th
                    className="px-3 py-3 text-right font-medium"
                    title="Cargar un cobro rápido. Para ver el historial completo, tocá el nombre del alumno."
                  >
                    Cargar cobro
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => {
                const lead = leadById.get(s.lead_id);
                const collected = collectedBySale.get(s.id) ?? 0;
                const total = Number(s.total_amount) || 0;
                const od = overdueBySale.get(s.id);
                const overdueAmount = od?.overdueAmount ?? 0;
                const overdueCount = od?.overdueCount ?? 0;
                const nextDue = od?.nextDueDate ?? null;
                const isSelected = effectiveSelected.has(s.id);
                const salePayments = paymentsBySaleId.get(s.id) ?? [];
                const paidUp = total > 0 && collected >= total;
                const leadForModal: Pick<
                  LeadRow,
                  "id" | "name" | "launch_id" | "team_member_id"
                > = lead
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

                return (
                  <tr
                    key={s.id}
                    className={
                      "border-t border-border hover:bg-surface " +
                      (isSelected ? "bg-accent/5" : "")
                    }
                  >
                    {canEdit && (
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleOne(s.id)}
                          aria-label={`Seleccionar venta de ${lead?.name ?? "sin alumno"}`}
                          className="accent-accent"
                        />
                      </td>
                    )}
                    <td className="px-3 py-3 font-medium text-fg">
                      <SaleModal
                        triggerLabel={lead?.name ?? "—"}
                        triggerClassName="underline-offset-2 hover:underline"
                        lead={leadForModal}
                        sales={[s]}
                        saleRanks={rankBySaleId}
                        paymentsBySaleId={new Map([[s.id, salePayments]])}
                        installmentsBySaleId={new Map([
                          [s.id, installmentsBySaleId.get(s.id) ?? []],
                        ])}
                        initialSaleId={s.id}
                        allowCreateAnother={false}
                        modalities={modalities}
                        products={products}
                        rules={rules}
                        paymentMethods={paymentMethods}
                        teamMembers={teamMembers}
                        createSaleAction={createSaleAction.bind(
                          null,
                          leadForModal.id,
                        )}
                        updateProductAction={(saleId, productId) =>
                          updateSaleProductAction(saleId, productId)
                        }
                        recalculateAction={recalculateSaleAction}
                        updateSaleAction={updateSaleAction}
                        addPaymentAction={addPaymentAction}
                        deletePaymentAction={deletePaymentAction}
                        deleteSaleAction={deleteSaleAction}
                        updatePaymentInstallmentAction={
                          updatePaymentInstallmentAction
                        }
                        updatePaymentMethodAction={updatePaymentMethodAction}
                        assignLeadOwnerAction={
                          canEdit ? assignLeadOwnerAction : undefined
                        }
                        fxLookup={fxLookup}
                        methodCurrencies={methodCurrencies}
                      />
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-fg">
                      {fmtRowMoney(total, s.id)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-fg">
                      {fmtRowMoney(collected, s.id)}
                    </td>
                    <td
                      className={
                        "px-3 py-3 text-right tabular-nums " +
                        (overdueAmount > 0 ? "text-error" : "text-fg-subtle")
                      }
                    >
                      {overdueAmount > 0
                        ? fmtRowMoney(overdueAmount, s.id)
                        : "—"}
                    </td>
                    <td
                      className={
                        "px-3 py-3 text-right tabular-nums " +
                        (overdueCount > 0 ? "text-error" : "text-fg-subtle")
                      }
                    >
                      {overdueCount > 0 ? fmtNumber(overdueCount) : "—"}
                    </td>
                    <td className="px-3 py-3 text-fg-muted">
                      {paidUp ? (
                        <span className="text-success">Al día</span>
                      ) : nextDue ? (
                        fmtDate(nextDue)
                      ) : (
                        "—"
                      )}
                    </td>
                    {canEdit && (
                      <td className="px-3 py-3 text-right">
                        <SaleModal
                          triggerLabel="+"
                          triggerAriaLabel={`Cargar cobro a ${lead?.name ?? "alumno"}`}
                          triggerClassName="inline-flex h-7 w-7 items-center justify-center rounded-md border border-accent/40 bg-accent/10 text-base font-bold leading-none text-accent hover:bg-accent/20"
                          variant="add-payment"
                          lead={leadForModal}
                          sales={[s]}
                          saleRanks={rankBySaleId}
                          paymentsBySaleId={new Map([[s.id, salePayments]])}
                          installmentsBySaleId={new Map([
                            [s.id, installmentsBySaleId.get(s.id) ?? []],
                          ])}
                          initialSaleId={s.id}
                          allowCreateAnother={false}
                          modalities={modalities}
                          products={products}
                          rules={rules}
                          paymentMethods={paymentMethods}
                          teamMembers={teamMembers}
                          createSaleAction={createSaleAction.bind(
                            null,
                            leadForModal.id,
                          )}
                          updateProductAction={(saleId, productId) =>
                            updateSaleProductAction(saleId, productId)
                          }
                          recalculateAction={recalculateSaleAction}
                          updateSaleAction={updateSaleAction}
                          addPaymentAction={addPaymentAction}
                          deletePaymentAction={deletePaymentAction}
                          deleteSaleAction={deleteSaleAction}
                          updatePaymentInstallmentAction={
                            updatePaymentInstallmentAction
                          }
                          updatePaymentMethodAction={updatePaymentMethodAction}
                          assignLeadOwnerAction={
                            canEdit ? assignLeadOwnerAction : undefined
                          }
                          methodCurrencies={methodCurrencies}
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-border bg-surface/60 text-sm">
              <tr>
                <td
                  className="px-3 py-3 font-semibold text-fg"
                  colSpan={totalColSpan}
                >
                  {filtersActive
                    ? `Subtotal filtrado · ${sales.length} venta${sales.length === 1 ? "" : "s"}`
                    : `Total · ${sales.length} venta${sales.length === 1 ? "" : "s"}`}
                </td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums text-fg">
                  {fmtTotalMoney(totalPactado)}
                </td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums text-fg">
                  {fmtTotalMoney(totalCobrado)}
                </td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums text-error">
                  {totalVencido > 0 ? fmtTotalMoney(totalVencido) : "—"}
                </td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums text-error">
                  {totalCuotasVencidas > 0 ? fmtNumber(totalCuotasVencidas) : "—"}
                </td>
                <td className="px-3 py-3" />
                {canEdit && <td className="px-3 py-3" />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
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
  readonly accumByPaymentId: ReadonlyMap<string, number>;
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

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-fg">Historial de cobros</h2>
        {filtersActive && (
          <span className="text-xs text-fg-subtle">
            {payments.length} de {totalPaymentsCount} cobros
          </span>
        )}
      </div>
      {payments.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-surface/40 p-8 text-center text-sm text-fg-muted">
          {totalPaymentsCount === 0 ? (
            <>
              Sin cobros registrados todavía. Usá el botón <b>+</b> en la tabla
              de ventas para cargar el primero.
            </>
          ) : filtersActive ? (
            "Ningún cobro coincide con los filtros aplicados."
          ) : (
            "Sin cobros."
          )}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="bg-surface text-left text-xs uppercase tracking-wide text-fg-subtle">
              <tr>
                <th className="px-3 py-3 font-medium">Fecha</th>
                <th className="px-3 py-3 font-medium">Alumno</th>
                <th className="px-3 py-3 font-medium">Producto</th>
                <th className="px-3 py-3 font-medium">Modalidad</th>
                <th className="px-3 py-3 font-medium">Cuota #</th>
                <th className="px-3 py-3 font-medium">Método</th>
                <th className="px-3 py-3 text-right font-medium">Monto</th>
                <th className="px-3 py-3 text-right font-medium">Acumulado venta</th>
                {canEdit && <th className="px-3 py-3" aria-label="Acciones" />}
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => {
                const sale = salesById.get(p.sale_id);
                const lead = sale ? leadById.get(sale.lead_id) : null;
                const modality = sale
                  ? modalityById.get(sale.payment_modality_id)
                  : null;
                const product = sale ? productById.get(sale.product_id) : null;
                const inst = p.installment_id
                  ? installmentById.get(p.installment_id) ?? null
                  : null;
                const method = p.payment_method_id
                  ? paymentMethodById.get(p.payment_method_id) ?? null
                  : null;
                return (
                  <tr
                    key={p.id}
                    className="border-t border-border hover:bg-surface"
                  >
                    <td className="px-3 py-3 text-fg-muted">
                      {fmtDate(p.paid_at)}
                    </td>
                    <td className="px-3 py-3 font-medium text-fg">
                      {lead?.name ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-fg-muted">
                      {product?.name ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-fg-muted">
                      {modality?.name ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-fg-muted">
                      {inst ? `Cuota ${inst.number}` : (
                        <span className="text-warning">Sin cuota</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-fg-muted">
                      {method?.name ?? (
                        <span className="text-warning">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-fg">
                      {fmtRowPay(p, Number(p.amount))}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-fg-muted">
                      {fmtRowPay(p, accumByPaymentId.get(p.id) ?? 0)}
                    </td>
                    {canEdit && (
                      <td className="px-3 py-3 text-right">
                        <DeletePaymentButton
                          paymentId={p.id}
                          amount={Number(p.amount)}
                          deletePaymentAction={deletePaymentAction}
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-border bg-surface/60 text-sm">
              <tr>
                <td
                  className="px-3 py-3 font-semibold text-fg"
                  colSpan={6}
                >
                  {filtersActive
                    ? `Subtotal filtrado · ${payments.length} cobro${payments.length === 1 ? "" : "s"}`
                    : `Total · ${payments.length} cobro${payments.length === 1 ? "" : "s"}`}
                </td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums text-fg">
                  {fmtTotal(totalMonto)}
                </td>
                <td className="px-3 py-3" />
                {canEdit && <td className="px-3 py-3" />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
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
      className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-error hover:bg-error/10 disabled:opacity-50"
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
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-accent/40 bg-accent/5 px-3 py-2">
      <span className="text-sm font-medium text-fg">
        {selectedCount} venta{selectedCount === 1 ? "" : "s"} seleccionada
        {selectedCount === 1 ? "" : "s"}
      </span>
      <select
        value={productId}
        onChange={(e) => setProductId(e.target.value)}
        disabled={pending}
        aria-label="Producto a asignar en bulk"
        className="rounded-md border border-border bg-bg-elevated px-2 py-1 text-sm text-fg disabled:opacity-50"
      >
        <option value="">Elegí producto…</option>
        {activeProducts.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1 text-xs text-fg-muted">
        <input
          type="checkbox"
          checked={regenerate}
          disabled={pending}
          onChange={(e) => setRegenerate(e.target.checked)}
          className="accent-accent"
        />
        Actualizar comisión con la regla del nuevo producto
      </label>
      <button
        type="button"
        disabled={pending || !productId}
        onClick={apply}
        className="rounded-md border border-accent/40 bg-accent/10 px-3 py-1 text-sm font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
      >
        {pending ? "Asignando…" : "Asignar"}
      </button>
      <button
        type="button"
        onClick={onClear}
        disabled={pending}
        className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg hover:bg-bg-elevated disabled:opacity-50"
      >
        Limpiar
      </button>
      {feedback && (
        <span
          className={
            "text-xs " +
            (feedback.fail === 0 ? "text-success" : "text-error")
          }
        >
          {feedback.fail === 0
            ? `${feedback.ok} venta${feedback.ok === 1 ? "" : "s"} actualizada${feedback.ok === 1 ? "" : "s"}.`
            : `${feedback.ok} OK · ${feedback.fail} con error${feedback.firstError ? ` (${feedback.firstError})` : ""}.`}
        </span>
      )}
    </div>
  );
}
