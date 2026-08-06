"use client";

import { useMemo, useState, useTransition } from "react";

import type {
  PaymentActionState,
  SaleActionState,
} from "@/app/(app)/proyectos/[projectId]/leads/sale-actions";
import { computeCommission, findApplicableRule } from "@/lib/commissions/calc";
import { buildSaleRanks } from "@/lib/commissions/ranking";
import type {
  CommissionRuleRow,
  InstallmentRow,
  PaymentModalityRow,
  PaymentRow,
  SaleRow,
} from "@/lib/commissions/types";
import { fmtMoney } from "@/lib/format";
import {
  fmtNative,
  fmtUsd,
  normalizePaymentsForSaleCurrency,
  type Currency,
  type FxLookup,
} from "@/lib/money";
import type { LeadRow } from "@/lib/leads/types";
import type { PaymentMethodRow } from "@/lib/payment-methods/types";
import type { ProductRow } from "@/lib/products/types";
import type { TeamMemberRow } from "@/lib/team/types";

import { AddSaleModal } from "./add-sale-modal";
import { SaleModal } from "./sale-modal";

type CreateSaleAction = (
  leadId: string,
  prev: SaleActionState,
  formData: FormData,
) => Promise<SaleActionState>;
type CreateSaleWithLeadAction = (
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

type LeadForSales = Pick<
  LeadRow,
  "id" | "name" | "launch_id" | "team_member_id" | "status"
>;

type CollectionStatus = "all" | "paid" | "partial" | "unpaid";

interface FilterState {
  query: string;
  launchId: string;
  closerId: string;
  productId: string;
  paymentMethodId: string;
  collection: CollectionStatus;
}

const EMPTY_FILTERS: FilterState = {
  query: "",
  launchId: "all",
  closerId: "all",
  productId: "all",
  paymentMethodId: "all",
  collection: "all",
};

const UNASSIGNED_LAUNCH = "__unassigned__";
const UNASSIGNED_CLOSER = "__unassigned__";
const NO_METHOD = "__none__";

/**
 * Cobrado por venta respetando moneda. Si todos los payments comparten la
 * moneda del sale → suma nativa. Si hay mismatch → USD (evita el bug de
 * sumar pesos + dólares como si fueran la misma unidad).
 */
interface CollectedDisplay {
  amount: number;
  currency: Currency;
  mixed: boolean;
}
function collectedForSale(
  saleCurrency: Currency,
  payments: ReadonlyArray<PaymentRow>,
  fxLookup: FxLookup | undefined,
): CollectedDisplay {
  if (payments.length === 0) {
    return { amount: 0, currency: saleCurrency, mixed: false };
  }
  if (!fxLookup) {
    let sum = 0;
    for (const p of payments) sum += Number(p.amount) || 0;
    return { amount: sum, currency: saleCurrency, mixed: false };
  }
  let native = 0;
  let allSame = true;
  for (const p of payments) {
    const c = fxLookup.byPaymentId[p.id]?.currency ?? saleCurrency;
    if (c !== saleCurrency) {
      allSame = false;
      break;
    }
    native += Number(p.amount) || 0;
  }
  if (allSame) {
    return { amount: native, currency: saleCurrency, mixed: false };
  }
  let usd = 0;
  for (const p of payments) {
    usd += fxLookup.byPaymentId[p.id]?.amountUsd ?? 0;
  }
  return { amount: usd, currency: "USD", mixed: true };
}

/**
 * Clasificador de estado de cobro FX-aware. Con moneda homogénea comparamos
 * en unidades nativas contra `total_amount`. Con mismatch, comparamos
 * cobrado(USD) contra `totalUsd`. Sin `totalUsd` (sale sin conversión),
 * degradamos al criterio crudo — imperfecto pero preserva el filtro.
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
 * Vista project-wide de ventas (Fase 12). Es intencionalmente más "plana" que
 * `CobrosView`: no muestra vencimientos ni cronograma acá — para eso está la
 * ficha (click en el nombre) y la vista de Cobros por launch. Acá el operador
 * mira producción total y edita/borra ventas.
 *
 * Método de pago por venta se agrega desde `payments`: hay ventas mixtas
 * (varios cobros con distintos métodos). Mostramos:
 *   - 0 métodos → "—" (venta sin cobrar)
 *   - 1 método → nombre
 *   - ≥2 métodos → "Mixto (N)" con tooltip listando los métodos
 */
export function ProjectSalesView({
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
  createSaleAction,
  createSaleWithLeadAction,
  addPaymentAction,
  deletePaymentAction,
  deleteSaleAction,
  updateSaleProductAction,
  recalculateSaleAction,
  updateSaleAction,
  updatePaymentInstallmentAction,
  updatePaymentMethodAction,
  assignLeadOwnerAction,
  fxLookup,
}: {
  readonly sales: ReadonlyArray<SaleRow>;
  readonly payments: ReadonlyArray<PaymentRow>;
  readonly installments: ReadonlyArray<InstallmentRow>;
  readonly invoices?: ReadonlyArray<{
    readonly id: string;
    readonly sale_id: string | null;
    readonly invoice_number: string | null;
    readonly installment_id: string | null;
    readonly amount_gross: number;
    readonly status: string;
  }>;
  readonly leads: ReadonlyArray<LeadForSales>;
  readonly launches: ReadonlyArray<{ id: string; name: string }>;
  readonly modalities: ReadonlyArray<PaymentModalityRow>;
  readonly products: ReadonlyArray<ProductRow>;
  readonly rules: ReadonlyArray<CommissionRuleRow>;
  readonly paymentMethods: ReadonlyArray<PaymentMethodRow>;
  readonly teamMembers: ReadonlyArray<
    Pick<TeamMemberRow, "id" | "name" | "active" | "role">
  >;
  readonly canEdit: boolean;
  /**
   * Lookup FX opcional. Cuando se pasa, cada fila muestra su moneda
   * nativa (AR$/US$) y el footer suma en USD. Sin fxLookup, fallback al
   * comportamiento antiguo (fmtMoney sin distinción de moneda).
   */
  readonly fxLookup?: FxLookup;
  readonly createSaleAction: CreateSaleAction;
  readonly createSaleWithLeadAction: CreateSaleWithLeadAction;
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
  const launchById = useMemo(
    () => new Map(launches.map((l) => [l.id, l])),
    [launches],
  );
  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );
  const paymentMethodById = useMemo(
    () => new Map(paymentMethods.map((m) => [m.id, m])),
    [paymentMethods],
  );
  const teamById = useMemo(
    () => new Map(teamMembers.map((m) => [m.id, m])),
    [teamMembers],
  );

  const paymentsBySaleId = useMemo(() => {
    const out = new Map<string, PaymentRow[]>();
    for (const p of payments) {
      const arr = out.get(p.sale_id);
      if (arr) arr.push(p);
      else out.set(p.sale_id, [p]);
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

  const collectedBySale = useMemo(() => {
    const out = new Map<string, number>();
    for (const p of payments) {
      out.set(p.sale_id, (out.get(p.sale_id) ?? 0) + Number(p.amount));
    }
    return out;
  }, [payments]);

  /**
   * Métodos de pago distintos usados por los cobros de cada venta. Un método
   * puede aparecer varias veces (varias cuotas cobradas por Stripe) — nos
   * quedamos con el set de ids únicos. `null` (payment sin método) se guarda
   * como marcador para que el filtro "sin método" funcione.
   */
  const methodIdsBySale = useMemo(() => {
    const out = new Map<string, Set<string | null>>();
    for (const p of payments) {
      const set = out.get(p.sale_id) ?? new Set<string | null>();
      set.add(p.payment_method_id);
      out.set(p.sale_id, set);
    }
    return out;
  }, [payments]);

  // Ranking por (team_member, launch) para pasarlo a `computeCommission` — mismo
  // patrón que CobrosView. Se calcula sobre el universo completo de sales, no
  // sobre el filtrado, porque el rank de una venta no cambia al filtrar la UI.
  const rankBySaleId = useMemo(
    () => buildSaleRanks(sales as unknown as SaleRow[]),
    [sales],
  );

  const commissionBySale = useMemo(() => {
    const out = new Map<string, { amount: number; currency: "ARS" | "USD" }>();
    for (const s of sales) {
      const salePays = paymentsBySaleId.get(s.id) ?? [];
      const rule = findApplicableRule(
        rules,
        s.payment_modality_id,
        s.launch_id,
        s.product_id,
      );
      // Normalizar payments a la moneda del sale para no romper el ratio
      // collected/pledged. TODO(ui): mostrar warning si hasMixed.
      const { normalized } = normalizePaymentsForSaleCurrency(
        s,
        salePays,
        fxLookup,
      );
      const breakdown = computeCommission(
        s,
        normalized,
        rule,
        rankBySaleId.get(s.id) ?? 0,
      );
      out.set(s.id, {
        amount: breakdown.commission,
        currency: breakdown.commissionCurrency,
      });
    }
    return out;
  }, [sales, paymentsBySaleId, rules, rankBySaleId, fxLookup]);

  const normalizedQuery = filters.query.trim().toLowerCase();

  function saleMatches(sale: SaleRow): boolean {
    const lead = leadById.get(sale.lead_id);

    if (normalizedQuery) {
      const name = (lead?.name ?? "").toLowerCase();
      if (!name.includes(normalizedQuery)) return false;
    }

    if (filters.launchId !== "all") {
      if (filters.launchId === UNASSIGNED_LAUNCH) {
        if (sale.launch_id !== null) return false;
      } else if (sale.launch_id !== filters.launchId) {
        return false;
      }
    }

    if (filters.closerId !== "all") {
      // Atribución autoritativa: el dueño del lead. `sale.team_member_id`
      // es denorm y puede driftear — la ficha del alumno y el leaderboard
      // (post-0047) también leen del lead.
      const closerId = leadById.get(sale.lead_id)?.team_member_id ?? null;
      if (filters.closerId === UNASSIGNED_CLOSER) {
        if (closerId !== null) return false;
      } else if (closerId !== filters.closerId) {
        return false;
      }
    }

    if (filters.productId !== "all" && sale.product_id !== filters.productId) {
      return false;
    }

    if (filters.paymentMethodId !== "all") {
      const set = methodIdsBySale.get(sale.id);
      if (!set || set.size === 0) return false;
      if (filters.paymentMethodId === NO_METHOD) {
        // Match si la venta tiene AL MENOS un cobro sin método asignado.
        if (!set.has(null)) return false;
      } else if (!set.has(filters.paymentMethodId)) {
        return false;
      }
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
    [sales, filters, leadById, methodIdsBySale, paymentsBySaleId, fxLookup],
  );

  const hasUnassignedLaunch = sales.some((s) => s.launch_id === null);
  // Mismo criterio autoritativo que la fila de tabla y el filtro.
  const hasUnassignedCloser = sales.some(
    (s) => (leadById.get(s.lead_id)?.team_member_id ?? null) === null,
  );
  const hasNoMethodPayment = payments.some((p) => p.payment_method_id === null);

  const filtersActive =
    filters.query !== "" ||
    filters.launchId !== "all" ||
    filters.closerId !== "all" ||
    filters.productId !== "all" ||
    filters.paymentMethodId !== "all" ||
    filters.collection !== "all";

  // Totales del subset visible.
  // Con fxLookup: totales en USD (convierte cada sale/pay). Sin fxLookup: suma
  // cruda que asume moneda única.
  let totalPactado = 0;
  let totalCobrado = 0;
  // Comisión: se acumula por moneda porque cada tier fixed tiene la suya
  // propia (migración 0107). El usuario pidió NO convertir — mostramos dos
  // totales cuando hay mezcla, uno único cuando todo comparte moneda.
  let totalComisionArs = 0;
  let totalComisionUsd = 0;
  const fmtRow = fxLookup
    ? (amount: number, saleId: string): string =>
        fmtNative(amount, fxLookup.bySaleId[saleId]?.currency ?? "USD")
    : (amount: number, _saleId: string): string => fmtMoney(amount);
  const fmtTotal = fxLookup ? fmtUsd : fmtMoney;
  for (const s of filteredSales) {
    if (fxLookup) {
      const usdSale = fxLookup.bySaleId[s.id]?.totalUsd ?? null;
      if (usdSale !== null) totalPactado += usdSale;
      // Cobrado en USD: sumamos cada payment convertido individualmente en
      // vez de escalar el total nativo por la tasa del sale — el escalado
      // rompe cuando los payments están en distinta moneda que el sale.
      for (const p of paymentsBySaleId.get(s.id) ?? []) {
        const usdPay = fxLookup.byPaymentId[p.id]?.amountUsd ?? null;
        if (usdPay !== null) totalCobrado += usdPay;
      }
    } else {
      totalPactado += Number(s.total_amount) || 0;
      totalCobrado += collectedBySale.get(s.id) ?? 0;
    }
    const c = commissionBySale.get(s.id);
    if (c) {
      if (c.currency === "USD") totalComisionUsd += c.amount;
      else totalComisionArs += c.amount;
    }
  }

  return (
    <div className="space-y-6">
      {canEdit && (
        <div className="flex justify-end">
          <AddSaleModal
            launches={launches}
            modalities={modalities}
            products={products}
            teamMembers={teamMembers}
            createSaleWithLeadAction={createSaleWithLeadAction}
          />
        </div>
      )}
      <FilterBar
        filters={filters}
        onChange={setFilters}
        launches={launches}
        closers={teamMembers}
        products={products}
        paymentMethods={paymentMethods}
        hasUnassignedLaunch={hasUnassignedLaunch}
        hasUnassignedCloser={hasUnassignedCloser}
        hasNoMethodPayment={hasNoMethodPayment}
        totalSalesCount={sales.length}
        filteredSalesCount={filteredSales.length}
        filtersActive={filtersActive}
      />

      {filteredSales.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-surface/40 p-8 text-center text-sm text-fg-muted">
          {sales.length === 0
            ? "Sin ventas registradas en el proyecto todavía."
            : "Ninguna venta coincide con los filtros aplicados."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[1080px] text-sm">
            <thead className="bg-surface text-left text-xs uppercase tracking-wide text-fg-subtle">
              <tr>
                <th className="px-3 py-3 font-medium">Alumno</th>
                <th className="px-3 py-3 font-medium">Producto</th>
                <th className="px-3 py-3 text-right font-medium">
                  Monto pactado
                </th>
                <th className="px-3 py-3 text-right font-medium">
                  Monto cobrado
                </th>
                <th className="px-3 py-3 text-right font-medium">Comisión</th>
                <th className="px-3 py-3 font-medium">Método</th>
                <th className="px-3 py-3 font-medium">Vendedor</th>
                <th className="px-3 py-3 font-medium">Lanzamiento</th>
                {canEdit && (
                  <th className="px-3 py-3 text-right font-medium">Acciones</th>
                )}
              </tr>
            </thead>
            <tbody>
              {filteredSales.map((s) => {
                const lead = leadById.get(s.lead_id);
                const product = productById.get(s.product_id);
                // Atribución del dueño del lead (autoritativa). Ver notas
                // en el filtro `closerId` sobre por qué no leemos
                // `sale.team_member_id`.
                const closerId = lead?.team_member_id ?? null;
                const closer = closerId ? teamById.get(closerId) : null;
                const launch = s.launch_id
                  ? launchById.get(s.launch_id)
                  : null;
                const commission = commissionBySale.get(s.id) ?? {
                  amount: 0,
                  currency: "ARS" as const,
                };
                const methodSet = methodIdsBySale.get(s.id);
                const methodDisplay = renderMethodCell(
                  methodSet,
                  paymentMethodById,
                );
                const salePayments = paymentsBySaleId.get(s.id) ?? [];
                const saleInstallments = installmentsBySaleId.get(s.id) ?? [];
                const saleCurrency: Currency =
                  fxLookup?.bySaleId[s.id]?.currency ?? "ARS";
                const collectedDisplay = collectedForSale(
                  saleCurrency,
                  salePayments,
                  fxLookup,
                );

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
                    className="border-t border-border hover:bg-surface"
                  >
                    <td className="px-3 py-3 font-medium text-fg">
                      <SaleModal
                        triggerLabel={lead?.name ?? "—"}
                        triggerClassName="underline-offset-2 hover:underline"
                        lead={leadForModal}
                        sales={[s]}
                        saleRanks={rankBySaleId}
                        paymentsBySaleId={new Map([[s.id, salePayments]])}
                        installmentsBySaleId={
                          new Map([[s.id, saleInstallments]])
                        }
                        invoicesBySaleId={
                          new Map([[s.id, invoicesBySaleId.get(s.id) ?? []]])
                        }
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
                      />
                    </td>
                    <td className="px-3 py-3 text-fg-muted">
                      {product?.name ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-fg">
                      {fmtRow(Number(s.total_amount), s.id)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-fg">
                      <div className="flex items-center justify-end gap-1">
                        <span>
                          {fxLookup
                            ? fmtNative(collectedDisplay.amount, collectedDisplay.currency)
                            : fmtMoney(collectedDisplay.amount)}
                        </span>
                        {collectedDisplay.mixed && (
                          <span
                            className="rounded bg-warning/15 px-1 py-0.5 text-[10px] font-medium text-warning"
                            title="Los cobros de esta venta están en moneda distinta al pactado. Total mostrado convertido a USD."
                          >
                            moneda distinta
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-accent">
                      {fmtNative(commission.amount, commission.currency)}
                    </td>
                    <td
                      className="px-3 py-3 text-fg-muted"
                      title={methodDisplay.title}
                    >
                      {methodDisplay.text}
                    </td>
                    <td className="px-3 py-3 text-fg-muted">
                      {closer?.name ?? (
                        <span className="text-warning">Sin asignar</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-fg-muted">
                      {launch?.name ?? "—"}
                    </td>
                    {canEdit && (
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <SaleModal
                            triggerLabel="Editar"
                            triggerClassName="rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg hover:bg-bg-elevated"
                            lead={leadForModal}
                            sales={[s]}
                            saleRanks={rankBySaleId}
                            paymentsBySaleId={
                              new Map([[s.id, salePayments]])
                            }
                            installmentsBySaleId={
                              new Map([[s.id, saleInstallments]])
                            }
                            invoicesBySaleId={
                              new Map([[s.id, invoicesBySaleId.get(s.id) ?? []]])
                            }
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
                            updatePaymentMethodAction={
                              updatePaymentMethodAction
                            }
                            assignLeadOwnerAction={
                              canEdit ? assignLeadOwnerAction : undefined
                            }
                            fxLookup={fxLookup}
                          />
                          <DeleteSaleButton
                            saleId={s.id}
                            leadName={lead?.name ?? "alumno"}
                            paymentCount={salePayments.length}
                            totalAmountLabel={fmtRow(
                              Number(s.total_amount) || 0,
                              s.id,
                            )}
                            deleteSaleAction={deleteSaleAction}
                          />
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-border bg-surface/60 text-sm">
              <tr>
                <td className="px-3 py-3 font-semibold text-fg" colSpan={2}>
                  {filtersActive
                    ? `Subtotal filtrado · ${filteredSales.length} venta${filteredSales.length === 1 ? "" : "s"}`
                    : `Total · ${filteredSales.length} venta${filteredSales.length === 1 ? "" : "s"}`}
                </td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums text-fg">
                  {fmtTotal(totalPactado)}
                </td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums text-fg">
                  {fmtTotal(totalCobrado)}
                </td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums text-accent">
                  {totalComisionArs > 0 && totalComisionUsd > 0 ? (
                    <div className="flex flex-col items-end leading-tight">
                      <span>{fmtNative(totalComisionArs, "ARS")}</span>
                      <span>{fmtNative(totalComisionUsd, "USD")}</span>
                    </div>
                  ) : totalComisionUsd > 0 ? (
                    fmtNative(totalComisionUsd, "USD")
                  ) : (
                    fmtNative(totalComisionArs, "ARS")
                  )}
                </td>
                <td className="px-3 py-3" colSpan={3} />
                {canEdit && <td className="px-3 py-3" />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Devuelve el label para la celda "Método" + un title (tooltip) con el detalle
 * cuando la venta tiene varios métodos. Si hay al menos un cobro sin método
 * asignado, lo marcamos aparte porque es un warning de backfill pendiente.
 */
function renderMethodCell(
  methodSet: ReadonlySet<string | null> | undefined,
  paymentMethodById: ReadonlyMap<string, PaymentMethodRow>,
): { text: React.ReactNode; title?: string } {
  if (!methodSet || methodSet.size === 0) {
    return { text: "—" };
  }
  const withMethod = Array.from(methodSet).filter(
    (id): id is string => id !== null,
  );
  const hasNull = methodSet.has(null);
  const names = withMethod
    .map((id) => paymentMethodById.get(id)?.name ?? "—")
    .sort((a, b) => a.localeCompare(b));

  if (names.length === 0) {
    // Solo cobros sin método.
    return {
      text: <span className="text-warning">Sin método</span>,
    };
  }
  if (names.length === 1) {
    const label = names[0]!;
    if (hasNull) {
      return {
        text: (
          <>
            {label} <span className="text-warning">+ sin método</span>
          </>
        ),
        title: `${label}; algún cobro sin método asignado`,
      };
    }
    return { text: label };
  }
  const detail = hasNull
    ? `${names.join(", ")}; algún cobro sin método asignado`
    : names.join(", ");
  return {
    text: `Mixto (${hasNull ? names.length + 1 : names.length})`,
    title: detail,
  };
}

function FilterBar({
  filters,
  onChange,
  launches,
  closers,
  products,
  paymentMethods,
  hasUnassignedLaunch,
  hasUnassignedCloser,
  hasNoMethodPayment,
  totalSalesCount,
  filteredSalesCount,
  filtersActive,
}: {
  readonly filters: FilterState;
  readonly onChange: (next: FilterState) => void;
  readonly launches: ReadonlyArray<{ id: string; name: string }>;
  readonly closers: ReadonlyArray<
    Pick<TeamMemberRow, "id" | "name" | "active">
  >;
  readonly products: ReadonlyArray<ProductRow>;
  readonly paymentMethods: ReadonlyArray<PaymentMethodRow>;
  readonly hasUnassignedLaunch: boolean;
  readonly hasUnassignedCloser: boolean;
  readonly hasNoMethodPayment: boolean;
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
      <select
        value={filters.closerId}
        onChange={(e) => onChange({ ...filters, closerId: e.target.value })}
        className="rounded-md border border-border bg-bg-elevated px-2 py-1 text-sm text-fg"
        aria-label="Filtrar por vendedor"
      >
        <option value="all">Todos los vendedores</option>
        {hasUnassignedCloser && (
          <option value={UNASSIGNED_CLOSER}>Sin asignar</option>
        )}
        {closers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {!c.active ? " (inactivo)" : ""}
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
        value={filters.paymentMethodId}
        onChange={(e) =>
          onChange({ ...filters, paymentMethodId: e.target.value })
        }
        className="rounded-md border border-border bg-bg-elevated px-2 py-1 text-sm text-fg"
        aria-label="Filtrar por método de pago"
      >
        <option value="all">Todos los métodos</option>
        {hasNoMethodPayment && (
          <option value={NO_METHOD}>Sin método asignado</option>
        )}
        {paymentMethods.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
            {!m.active ? " (inactivo)" : ""}
          </option>
        ))}
      </select>
      <select
        value={filters.collection}
        onChange={(e) =>
          onChange({
            ...filters,
            collection: e.target.value as CollectionStatus,
          })
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

function DeleteSaleButton({
  saleId,
  leadName,
  paymentCount,
  totalAmountLabel,
  deleteSaleAction,
}: {
  readonly saleId: string;
  readonly leadName: string;
  readonly paymentCount: number;
  /** Monto ya formateado con su moneda nativa (AR$/US$). */
  readonly totalAmountLabel: string;
  readonly deleteSaleAction: DeleteSaleAction;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        const msg =
          paymentCount > 0
            ? `¿Borrar la venta de ${leadName} (${totalAmountLabel}) y sus ${paymentCount} cobro${paymentCount === 1 ? "" : "s"}?`
            : `¿Borrar la venta de ${leadName} (${totalAmountLabel})?`;
        if (!confirm(msg)) return;
        startTransition(async () => {
          await deleteSaleAction(saleId);
        });
      }}
      aria-label={`Borrar venta de ${leadName}`}
      className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-error hover:bg-error/10 disabled:opacity-50"
    >
      {pending ? "…" : "Borrar"}
    </button>
  );
}
