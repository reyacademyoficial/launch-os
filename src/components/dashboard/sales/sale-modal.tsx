"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";

import type {
  PaymentActionState,
  SaleActionState,
} from "@/app/(app)/(kg)/proyectos/[projectId]/leads/sale-actions";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { computeCommission, findApplicableRule } from "@/lib/commissions/calc";
import type {
  CommissionRuleRow,
  InstallmentRow,
  PaymentModalityRow,
  PaymentRow,
  SaleRow,
} from "@/lib/commissions/types";
import { fmtDate, fmtMoney, fmtPercent } from "@/lib/format";
import {
  fmtNative,
  fmtUsd,
  normalizePaymentsForSaleCurrency,
  type Currency,
  type FxLookup,
} from "@/lib/money";

/**
 * Helpers de formato que respetan la moneda nativa del sale/payment cuando
 * hay lookup FX disponible. Sin fxLookup, fallback a `fmtMoney` legacy.
 */
function fmtSaleMoney(
  fxLookup: FxLookup | undefined,
  sale: { id: string } | null,
  amount: number,
): string {
  if (!fxLookup || !sale) return fmtMoney(amount);
  return fmtNative(amount, fxLookup.bySaleId[sale.id]?.currency ?? "USD");
}
function fmtPaymentMoney(
  fxLookup: FxLookup | undefined,
  payment: { id: string; amount: number },
): string {
  if (!fxLookup) return fmtMoney(payment.amount);
  return fmtNative(
    Number(payment.amount),
    fxLookup.byPaymentId[payment.id]?.currency ?? "USD",
  );
}

/**
 * Cobrado real de la venta respetando moneda. Si todos los payments comparten
 * la moneda del sale, suma nativa. Si hay mismatch, cambia a USD (evita sumar
 * pesos + dólares como si fueran la misma unidad — el bug clásico de FX).
 */
interface CollectedDisplay {
  amount: number;
  currency: Currency;
  mixed: boolean;
}

/**
 * Factura emitida asociable a un cobro. Post 0114/0115/0116: cada cuota tiene
 * una factura emitida generada automáticamente. El form de cobro auto-elige
 * la factura correspondiente a la cuota seleccionada (1 cuota = 1 factura).
 */
export interface InvoiceOption {
  readonly id: string;
  readonly invoice_number: string | null;
  readonly installment_id: string | null;
  readonly amount_gross: number;
  readonly status: string;
}
function collectedForSale(
  fxLookup: FxLookup | undefined,
  sale: { id: string },
  payments: ReadonlyArray<PaymentRow>,
): CollectedDisplay {
  const saleCurrency: Currency =
    fxLookup?.bySaleId[sale.id]?.currency ?? "ARS";
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
    const v = fxLookup.byPaymentId[p.id]?.amountUsd ?? 0;
    usd += v;
  }
  return { amount: usd, currency: "USD", mixed: true };
}
function fmtCollected(
  display: CollectedDisplay,
  fxLookup: FxLookup | undefined,
): string {
  if (!fxLookup) return fmtMoney(display.amount);
  return display.currency === "USD" && display.mixed
    ? fmtUsd(display.amount)
    : fmtNative(display.amount, display.currency);
}
import {
  classifyClient,
  computeInstallmentStatuses,
  summarizeSaleOverdue,
  todayInAR,
  type ClientClassification,
  type InstallmentStatus,
} from "@/lib/installments/status";
import type { LeadRow } from "@/lib/leads/types";
import type { PaymentMethodRow } from "@/lib/payment-methods/types";
import type { ProductRow } from "@/lib/products/types";
import type { TeamMemberRow } from "@/lib/team/types";

import { InstallmentPlanFields } from "./installment-plan-fields";

type SaleAction = (
  prev: SaleActionState,
  formData: FormData,
) => Promise<SaleActionState>;
type AddPaymentActionForSale = (
  saleId: string,
  prev: PaymentActionState,
  formData: FormData,
) => Promise<PaymentActionState>;
type DeletePaymentAction = (paymentId: string) => Promise<void>;
type UpdateProductAction = (
  saleId: string,
  productId: string,
) => Promise<{ ok: true } | { error: string }>;
type RecalculateAction = (
  saleId: string,
) => Promise<{ ok: true } | { error: string }>;
type DeleteSaleAction = (saleId: string) => Promise<void>;
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

type BoundAddPayment = (
  prev: PaymentActionState,
  formData: FormData,
) => Promise<PaymentActionState>;
type BoundUpdateProduct = (
  productId: string,
) => Promise<{ ok: true } | { error: string }>;
type BoundRecalculate = () => Promise<{ ok: true } | { error: string }>;
type BoundDeleteSale = () => Promise<void>;

/**
 * Modal que sirve tanto para "cargar venta" como para la ficha completa del
 * alumno (Fase 11). Encabezado en modo `list` muestra closer + producto +
 * modalidad + fecha cierre + % cobrado + badge bueno/regular/malo del alumno.
 *
 * Cuotas (installments) son la unidad de trabajo de los cobros: cada payment
 * se linkea a una cuota puntual. Al regenerar el plan (cambiar cantidad o
 * frecuencia), los payments quedan huérfanos y el operador los re-asigna
 * desde la lista de cobros.
 */
export function SaleModal({
  triggerLabel,
  triggerClassName,
  triggerAriaLabel,
  variant = "full",
  lead,
  sales,
  saleRanks,
  paymentsBySaleId,
  installmentsBySaleId,
  invoicesBySaleId,
  modalities,
  products,
  rules,
  paymentMethods,
  teamMembers,
  initialSaleId,
  allowCreateAnother = true,
  createSaleAction,
  updateSaleAction,
  updateProductAction,
  recalculateAction,
  addPaymentAction,
  deletePaymentAction,
  deleteSaleAction,
  updatePaymentInstallmentAction,
  updatePaymentMethodAction,
  assignLeadOwnerAction,
  fxLookup,
  methodCurrencies,
  hideCommission = false,
}: {
  readonly triggerLabel: string;
  readonly triggerClassName?: string;
  /** Accessible label del botón trigger. Necesario cuando `triggerLabel` es solo un ícono ("+") y no describe la acción a lectores de pantalla. */
  readonly triggerAriaLabel?: string;
  /**
   * `"full"` (default) muestra la ficha completa del alumno (encabezado, cronograma,
   * historial, borrar venta). `"add-payment"` reduce el modal solo al form de
   * cargar cobro — pensado para el botón "+" de la tabla de ventas cerradas
   * donde el operador solo quiere sumar plata sin ver toda la ficha.
   */
  readonly variant?: "full" | "add-payment";
  readonly lead: Pick<LeadRow, "id" | "name" | "launch_id" | "team_member_id">;
  readonly sales: ReadonlyArray<SaleRow>;
  readonly saleRanks: ReadonlyMap<string, number>;
  readonly paymentsBySaleId: ReadonlyMap<string, ReadonlyArray<PaymentRow>>;
  /** Cuotas indexadas por sale_id — Fase 11. Puede estar vacío para ventas legacy sin backfill (no debería ocurrir tras 0043). */
  readonly installmentsBySaleId: ReadonlyMap<string, ReadonlyArray<InstallmentRow>>;
  /** Facturas emitidas indexadas por sale_id — Paso 4. Opcional (compat con callers que aún no la resuelven). */
  readonly invoicesBySaleId?: ReadonlyMap<string, ReadonlyArray<InvoiceOption>>;
  readonly modalities: ReadonlyArray<PaymentModalityRow>;
  readonly products: ReadonlyArray<ProductRow>;
  readonly rules: ReadonlyArray<CommissionRuleRow>;
  readonly paymentMethods: ReadonlyArray<PaymentMethodRow>;
  readonly teamMembers: ReadonlyArray<
    Pick<TeamMemberRow, "id" | "name" | "active" | "role">
  >;
  readonly initialSaleId?: string;
  readonly allowCreateAnother?: boolean;
  readonly createSaleAction: SaleAction;
  readonly updateSaleAction?: (
    saleId: string,
    prev: SaleActionState,
    formData: FormData,
  ) => Promise<SaleActionState>;
  readonly updateProductAction?: UpdateProductAction;
  readonly recalculateAction?: RecalculateAction;
  readonly addPaymentAction: AddPaymentActionForSale;
  readonly deletePaymentAction: DeletePaymentAction;
  readonly deleteSaleAction?: DeleteSaleAction;
  readonly updatePaymentInstallmentAction?: UpdatePaymentInstallmentAction;
  readonly updatePaymentMethodAction?: UpdatePaymentMethodAction;
  readonly assignLeadOwnerAction?: AssignLeadOwnerAction;
  /**
   * Lookup FX opcional. Cuando se pasa, todos los montos del modal se
   * muestran en su moneda nativa (AR$ o US$). Sin fxLookup, fallback a
   * `fmtMoney` legacy sin distinción.
   */
  readonly fxLookup?: FxLookup;
  readonly methodCurrencies?: Record<string, "ARS" | "USD">;
  /**
   * Oculta todo lo relacionado a comisión (card, snapshot bar con recalcular,
   * checkbox de recálculo en el edit form). Usado para el rol `closer`, que
   * ve la ficha del alumno pero no la comisión propia.
   */
  readonly hideCommission?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"list" | "new" | "edit">("list");
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode(sales.length === 0 ? "new" : "list");
    if (sales.length === 0) {
      setSelectedSaleId(null);
      return;
    }
    if (initialSaleId && sales.some((s) => s.id === initialSaleId)) {
      setSelectedSaleId(initialSaleId);
    } else {
      setSelectedSaleId(sales[0]!.id);
    }
  }, [open, sales, initialSaleId]);

  const selectedSale =
    variant === "add-payment"
      ? initialSaleId
        ? sales.find((s) => s.id === initialSaleId) ?? sales[0] ?? null
        : sales[0] ?? null
      : (mode === "list" || mode === "edit") && selectedSaleId
        ? sales.find((s) => s.id === selectedSaleId) ?? null
        : null;

  const headerTitle =
    variant === "add-payment"
      ? "Cargar cobro"
      : mode === "new"
        ? sales.length > 0
          ? "Nueva venta para este lead"
          : "Registrar venta"
        : mode === "edit"
          ? "Editar venta"
          : sales.length > 1
            ? `Ventas (${sales.length})`
            : "Ficha del alumno";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={triggerAriaLabel}
        title={triggerAriaLabel}
        className={
          triggerClassName ??
          "rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg hover:bg-bg-elevated"
        }
      >
        {triggerLabel}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 sm:p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-md border border-border bg-bg-elevated shadow-card">
            <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
              <div>
                <h3 className="text-lg font-bold text-fg">{headerTitle}</h3>
                <p className="mt-0.5 text-xs text-fg-subtle">{lead.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                className="text-fg-subtle hover:text-fg"
              >
                ×
              </button>
            </header>

            {variant === "full" && mode === "list" && sales.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface/40 px-6 py-3">
                {sales.length > 1 && (
                  <SaleTabs
                    sales={sales}
                    products={products}
                    selectedSaleId={selectedSaleId}
                    onSelect={setSelectedSaleId}
                    fxLookup={fxLookup}
                  />
                )}
                {allowCreateAnother && (
                  <button
                    type="button"
                    onClick={() => setMode("new")}
                    className="ml-auto rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg hover:bg-bg-elevated"
                  >
                    + Nueva venta
                  </button>
                )}
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-6 py-6">
              {variant === "add-payment" ? (
                selectedSale ? (
                  <AddPaymentOnly
                    sale={selectedSale}
                    payments={paymentsBySaleId.get(selectedSale.id) ?? []}
                    installments={
                      installmentsBySaleId.get(selectedSale.id) ?? []
                    }
                    invoices={invoicesBySaleId?.get(selectedSale.id) ?? []}
                    paymentMethods={paymentMethods}
                    addPaymentAction={(prev, fd) =>
                      addPaymentAction(selectedSale.id, prev, fd)
                    }
                    onSuccess={() => setOpen(false)}
                    fxLookup={fxLookup}
                    methodCurrencies={methodCurrencies ?? {}}
                  />
                ) : (
                  <p className="text-sm text-fg-muted">
                    No hay venta cargada para este alumno.
                  </p>
                )
              ) : mode === "new" ? (
                <NewSaleForm
                  lead={lead}
                  modalities={modalities}
                  products={products}
                  teamMembers={teamMembers}
                  createSaleAction={createSaleAction}
                  onCancel={
                    sales.length > 0 ? () => setMode("list") : undefined
                  }
                  onSuccess={() => {
                    if (sales.length > 0) setMode("list");
                    else setOpen(false);
                  }}
                />
              ) : mode === "edit" && selectedSale && updateSaleAction ? (
                <EditSaleForm
                  sale={selectedSale}
                  modalities={modalities}
                  products={products}
                  updateSaleAction={(prev, fd) =>
                    updateSaleAction(selectedSale.id, prev, fd)
                  }
                  onCancel={() => setMode("list")}
                  onSuccess={() => setMode("list")}
                  hideCommission={hideCommission}
                />
              ) : selectedSale ? (
                <SalePanel
                  sale={selectedSale}
                  saleRank={saleRanks.get(selectedSale.id) ?? 0}
                  payments={paymentsBySaleId.get(selectedSale.id) ?? []}
                  installments={installmentsBySaleId.get(selectedSale.id) ?? []}
                  invoices={invoicesBySaleId?.get(selectedSale.id) ?? []}
                  paymentMethods={paymentMethods}
                  modalities={modalities}
                  products={products}
                  rules={rules}
                  launchId={selectedSale.launch_id}
                  methodCurrencies={methodCurrencies ?? {}}
                  lead={lead}
                  teamMembers={teamMembers}
                  onEdit={
                    updateSaleAction ? () => setMode("edit") : undefined
                  }
                  updateProductAction={
                    updateProductAction
                      ? (productId) =>
                          updateProductAction(selectedSale.id, productId)
                      : undefined
                  }
                  recalculateAction={
                    recalculateAction
                      ? () => recalculateAction(selectedSale.id)
                      : undefined
                  }
                  addPaymentAction={(prev, fd) =>
                    addPaymentAction(selectedSale.id, prev, fd)
                  }
                  deletePaymentAction={deletePaymentAction}
                  deleteSaleAction={
                    deleteSaleAction
                      ? () => deleteSaleAction(selectedSale.id)
                      : undefined
                  }
                  updatePaymentInstallmentAction={updatePaymentInstallmentAction}
                  updatePaymentMethodAction={updatePaymentMethodAction}
                  assignOwnerAction={
                    assignLeadOwnerAction
                      ? (teamMemberId) =>
                          assignLeadOwnerAction(lead.id, teamMemberId)
                      : undefined
                  }
                  onSaleDeleted={() => {
                    if (sales.length > 1) {
                      setSelectedSaleId(null);
                    } else {
                      setOpen(false);
                    }
                  }}
                  fxLookup={fxLookup}
                  hideCommission={hideCommission}
                />
              ) : (
                <p className="text-sm text-fg-muted">
                  Elegí una venta del selector.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SaleTabs({
  sales,
  products,
  selectedSaleId,
  onSelect,
  fxLookup,
}: {
  readonly sales: ReadonlyArray<SaleRow>;
  readonly products: ReadonlyArray<ProductRow>;
  readonly selectedSaleId: string | null;
  readonly onSelect: (saleId: string) => void;
  readonly fxLookup?: FxLookup;
}) {
  return (
    <div className="flex flex-wrap gap-1" role="tablist">
      {sales.map((s, i) => {
        const product = products.find((p) => p.id === s.product_id);
        const active = s.id === selectedSaleId;
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(s.id)}
            className={
              "rounded-md border px-2 py-1 text-xs " +
              (active
                ? "border-accent bg-accent/10 text-accent"
                : "border-border bg-surface text-fg-muted hover:text-fg")
            }
          >
            #{i + 1} · {product?.name ?? "—"} ·{" "}
            {fmtSaleMoney(fxLookup, s, Number(s.total_amount))}
          </button>
        );
      })}
    </div>
  );
}

// ─── Form de venta nueva ───────────────────────────────────────────────────

function NewSaleForm({
  lead,
  modalities,
  products,
  teamMembers,
  createSaleAction,
  onSuccess,
  onCancel,
}: {
  readonly lead: Pick<LeadRow, "id" | "team_member_id">;
  readonly modalities: ReadonlyArray<PaymentModalityRow>;
  readonly products: ReadonlyArray<ProductRow>;
  readonly teamMembers: ReadonlyArray<Pick<TeamMemberRow, "id" | "name" | "active">>;
  readonly createSaleAction: SaleAction;
  readonly onSuccess: () => void;
  readonly onCancel?: () => void;
}) {
  const [state, formAction, pending] = useActionState<SaleActionState, FormData>(
    createSaleAction,
    null,
  );

  // Estado controlado sólo para lo que el preview de cuotas necesita observar.
  const today = todayInAR();
  const [totalAmount, setTotalAmount] = useState<number>(0);
  const [closedAt, setClosedAt] = useState<string>(today);

  useEffect(() => {
    if (state && "ok" in state && state.ok) onSuccess();
  }, [state, onSuccess]);

  const activeModalities = modalities.filter((m) => m.active);
  const activeProducts = products.filter((p) => p.active);
  const ownerName = lead.team_member_id
    ? teamMembers.find((t) => t.id === lead.team_member_id)?.name ?? null
    : null;

  if (activeModalities.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-surface/40 p-4 text-sm text-fg-muted">
        No hay modalidades de pago configuradas. Pedile al admin que cargue
        las modalidades en <b>Comisiones</b> antes de registrar ventas.
      </div>
    );
  }
  if (activeProducts.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-surface/40 p-4 text-sm text-fg-muted">
        No hay productos configurados. Pedile al admin que cargue el catálogo
        en <b>Productos</b> antes de registrar ventas.
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <Label htmlFor="sale-product">Producto *</Label>
        <Select id="sale-product" name="product_id" required defaultValue="">
          <option value="" disabled>
            Elegí un producto
          </option>
          {activeProducts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="sale-modality">Modalidad de pago *</Label>
        <Select
          id="sale-modality"
          name="payment_modality_id"
          required
          defaultValue=""
        >
          <option value="" disabled>
            Elegí una modalidad
          </option>
          {activeModalities.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr_1fr]">
        <div>
          <Label htmlFor="sale-total">Monto pactado *</Label>
          <Input
            id="sale-total"
            name="total_amount"
            type="number"
            step="0.01"
            min="0"
            required
            placeholder="Ej: 1000"
            onChange={(e) => setTotalAmount(parseFloat(e.target.value) || 0)}
          />
        </div>
        <div>
          <Label htmlFor="sale-currency">Moneda</Label>
          <Select id="sale-currency" name="currency" defaultValue="ARS">
            <option value="ARS">Pesos (ARS)</option>
            <option value="USD">Dólares (USD)</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="sale-closed-at">Fecha de cierre</Label>
          <Input
            id="sale-closed-at"
            name="closed_at"
            type="date"
            defaultValue={today}
            onChange={(e) => setClosedAt(e.target.value)}
          />
        </div>
      </div>

      <InstallmentPlanFields totalAmount={totalAmount} startDate={closedAt} />

      <div className="rounded-md border border-border bg-surface/40 px-3 py-2 text-xs">
        <div className="uppercase tracking-wide text-fg-subtle">
          Atribución
        </div>
        <div className="mt-1 text-fg">{ownerName ?? "Sin asignar"}</div>
        <p className="mt-1 text-fg-subtle">
          La venta se imputa al dueño del lead. Para cambiar la atribución,
          editá el setter desde la tarjeta del lead.
        </p>
      </div>

      <div className="flex items-center gap-4 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Registrando…" : "Registrar venta"}
        </Button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="text-xs text-fg-muted hover:text-fg disabled:opacity-50"
          >
            Cancelar
          </button>
        )}
        {state && "error" in state && <FieldError>{state.error}</FieldError>}
      </div>
    </form>
  );
}

// ─── Panel de venta + cuotas + cobros (ficha del alumno) ─────────────────

function SalePanel({
  sale,
  saleRank,
  payments,
  installments,
  invoices,
  paymentMethods,
  modalities,
  products,
  rules,
  launchId,
  lead,
  teamMembers,
  onEdit,
  updateProductAction,
  recalculateAction,
  addPaymentAction,
  deletePaymentAction,
  deleteSaleAction,
  updatePaymentInstallmentAction,
  updatePaymentMethodAction,
  assignOwnerAction,
  onSaleDeleted,
  fxLookup,
  methodCurrencies,
  hideCommission = false,
}: {
  readonly sale: SaleRow;
  readonly saleRank: number;
  readonly payments: ReadonlyArray<PaymentRow>;
  readonly installments: ReadonlyArray<InstallmentRow>;
  readonly invoices?: ReadonlyArray<InvoiceOption>;
  readonly paymentMethods: ReadonlyArray<PaymentMethodRow>;
  readonly modalities: ReadonlyArray<PaymentModalityRow>;
  readonly products: ReadonlyArray<ProductRow>;
  readonly rules: ReadonlyArray<CommissionRuleRow>;
  readonly launchId: string | null;
  readonly lead: Pick<LeadRow, "team_member_id">;
  readonly teamMembers: ReadonlyArray<
    Pick<TeamMemberRow, "id" | "name" | "active" | "role">
  >;
  readonly onEdit?: () => void;
  readonly updateProductAction?: BoundUpdateProduct;
  readonly recalculateAction?: BoundRecalculate;
  readonly addPaymentAction: BoundAddPayment;
  readonly deletePaymentAction: DeletePaymentAction;
  readonly deleteSaleAction?: BoundDeleteSale;
  readonly updatePaymentInstallmentAction?: UpdatePaymentInstallmentAction;
  readonly updatePaymentMethodAction?: UpdatePaymentMethodAction;
  /** Reasigna el vendedor del lead — propaga a todas sus sales. */
  readonly assignOwnerAction?: (
    teamMemberId: string | null,
  ) => Promise<{ ok: true } | { error: string }>;
  readonly onSaleDeleted: () => void;
  readonly fxLookup?: FxLookup;
  readonly methodCurrencies: Record<string, "ARS" | "USD">;
  readonly hideCommission?: boolean;
}) {
  const modality = modalities.find((m) => m.id === sale.payment_modality_id);
  const product = products.find((p) => p.id === sale.product_id);
  const rule = findApplicableRule(rules, sale.payment_modality_id, launchId);
  // Normalizamos payments a la moneda del sale antes del calc — evita que
  // un cobro USD y una venta ARS (o viceversa) crucen unidades en el ratio
  // collected/pledged. TODO(ui): mostrar warning si hasMixed y no todos los
  // payments se pudieron convertir.
  const { normalized: normalizedPayments } = normalizePaymentsForSaleCurrency(
    sale,
    payments,
    fxLookup,
  );
  const breakdown = computeCommission(sale, normalizedPayments, rule, saleRank);
  const [deletePending, startDeleteTransition] = useTransition();

  const today = todayInAR();
  const closerName = lead.team_member_id
    ? teamMembers.find((t) => t.id === lead.team_member_id)?.name ?? null
    : null;

  const statuses = useMemo(() => {
    const { normalized } = normalizePaymentsForSaleCurrency(sale, payments, fxLookup);
    return computeInstallmentStatuses(installments, normalized, sale.grace_days, today);
  }, [installments, payments, fxLookup, sale, today]);
  const overdue = useMemo(() => summarizeSaleOverdue(statuses), [statuses]);
  const classification = useMemo(() => classifyClient(statuses), [statuses]);

  const total = Number(sale.total_amount) || 0;
  const collectedDisplay = collectedForSale(fxLookup, sale, payments);
  // % cobrado: si la moneda coincide, ratio directo; si hay mismatch, usamos
  // el equivalente USD del pactado para no cruzar unidades.
  const pledgedUsdForPct = fxLookup?.bySaleId[sale.id]?.totalUsd ?? null;
  const collectedPct = collectedDisplay.mixed
    ? pledgedUsdForPct && pledgedUsdForPct > 0
      ? (collectedDisplay.amount / pledgedUsdForPct) * 100
      : 0
    : total > 0
      ? (collectedDisplay.amount / total) * 100
      : 0;

  const orphanPayments = payments.filter((p) => !p.installment_id);
  const missingMethod = payments.filter((p) => !p.payment_method_id).length;

  return (
    <div className="space-y-6">
      {/* Encabezado ficha */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <ClientBadge classification={classification} />
          {overdue.overdueCount > 0 && (
            <span className="rounded-full bg-error/10 px-2 py-0.5 text-xs font-medium text-error">
              {overdue.overdueCount} cuota{overdue.overdueCount === 1 ? "" : "s"} vencida{overdue.overdueCount === 1 ? "" : "s"}
              {" · "}
              {fmtSaleMoney(fxLookup, sale, overdue.overdueAmount)}
            </span>
          )}
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="ml-auto rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg hover:bg-bg-elevated"
            >
              Editar venta
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
          {assignOwnerAction ? (
            <CloserAssignField
              currentOwnerId={lead.team_member_id ?? null}
              teamMembers={teamMembers}
              assignOwnerAction={assignOwnerAction}
            />
          ) : (
            <FieldRow label="Closer" value={closerName ?? "Sin asignar"} />
          )}
          <FieldRow label="Producto" value={product?.name ?? "—"} />
          <FieldRow label="Modalidad" value={modality?.name ?? "—"} />
          <FieldRow label="Fecha de cierre" value={fmtDate(sale.closed_at)} />
          <FieldRow
            label="Plan"
            value={
              sale.installment_count === 1
                ? "Pago único"
                : `${sale.installment_count} · ${frequencyLabel(sale.installment_frequency)}`
            }
          />
          <FieldRow label="% cobrado" value={fmtPercent(collectedPct)} />
        </div>

        <div
          className={
            hideCommission
              ? "grid grid-cols-1 gap-3 sm:grid-cols-2"
              : "grid grid-cols-1 gap-3 sm:grid-cols-3"
          }
        >
          <Card label="Pactado" value={fmtSaleMoney(fxLookup, sale, Number(sale.total_amount))} />
          <Card
            label="Cobrado"
            value={fmtCollected(collectedDisplay, fxLookup)}
            hint={
              collectedDisplay.mixed
                ? `${payments.length} cobro${payments.length === 1 ? "" : "s"} · convertido a USD (moneda distinta al pactado)`
                : `${payments.length} cobro${payments.length === 1 ? "" : "s"}`
            }
          />
          {!hideCommission && (
            <Card
              label="Comisión actual"
              value={fmtNative(breakdown.commission, breakdown.commissionCurrency)}
              hint={breakdown.formula}
              accent
            />
          )}
        </div>
      </section>

      {!hideCommission && (
        <CommissionSnapshotBar
          hasSnapshot={sale.commission_rule_snapshot !== null}
          recalculateAction={recalculateAction}
        />
      )}

      <ProductAssign
        currentProductId={sale.product_id}
        currentProductName={product?.name ?? "—"}
        products={products}
        updateProductAction={updateProductAction}
      />

      {/* Cronograma de cuotas */}
      <InstallmentsTimeline statuses={statuses} sale={sale} fxLookup={fxLookup} />

      {/* Cobros huérfanos: warning + UI de re-linkeo */}
      {orphanPayments.length > 0 && updatePaymentInstallmentAction && (
        <OrphanPaymentsPanel
          orphanPayments={orphanPayments}
          installments={installments}
          updateAction={updatePaymentInstallmentAction}
          sale={sale}
          fxLookup={fxLookup}
        />
      )}

      {/* Form cargar cobro */}
      <PaymentForm
        installments={installments}
        invoices={invoices ?? []}
        statuses={statuses}
        paymentMethods={paymentMethods}
        addPaymentAction={addPaymentAction}
        methodCurrencies={methodCurrencies}
        saleCurrency={fxLookup?.bySaleId[sale.id]?.currency ?? "ARS"}
      />

      {/* Lista de cobros */}
      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
            Historial de cobros
          </h4>
          {missingMethod > 0 && (
            <span className="text-xs text-warning">
              {missingMethod} cobro{missingMethod === 1 ? "" : "s"} sin método
            </span>
          )}
        </div>
        {payments.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-surface/40 p-4 text-sm text-fg-muted">
            Todavía no se cargó ningún cobro.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {payments
              .slice()
              .sort((a, b) => a.paid_at.localeCompare(b.paid_at))
              .map((p) => (
                <PaymentRowItem
                  key={p.id}
                  payment={p}
                  installments={installments}
                  paymentMethods={paymentMethods}
                  deletePaymentAction={deletePaymentAction}
                  updatePaymentMethodAction={updatePaymentMethodAction}
                  fxLookup={fxLookup}
                />
              ))}
          </ul>
        )}
      </section>

      {deleteSaleAction && (
        <section className="rounded-md border border-error/30 bg-error/5 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-error">
            Borrar venta
          </h4>
          <p className="mt-1 text-xs text-fg-muted">
            Se borra la venta, sus cuotas y sus {payments.length} cobro
            {payments.length === 1 ? "" : "s"}. El lead queda intacto en la
            columna <b>cerrado</b> — movelo a otra columna si querés.
          </p>
          <button
            type="button"
            disabled={deletePending}
            onClick={() => {
              const msg =
                payments.length > 0
                  ? `¿Borrar la venta de ${fmtSaleMoney(fxLookup, sale, Number(sale.total_amount))} y sus ${payments.length} cobros?`
                  : `¿Borrar la venta de ${fmtSaleMoney(fxLookup, sale, Number(sale.total_amount))}?`;
              if (!confirm(msg)) return;
              startDeleteTransition(async () => {
                await deleteSaleAction();
                onSaleDeleted();
              });
            }}
            className="mt-3 rounded-md border border-error/40 bg-error/10 px-3 py-1.5 text-xs font-medium text-error hover:bg-error/20 disabled:opacity-50"
          >
            {deletePending ? "Borrando…" : "Borrar venta"}
          </button>
        </section>
      )}
    </div>
  );
}

function FieldRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="rounded-md border border-border bg-surface/40 px-3 py-2">
      <div className="uppercase tracking-wide text-fg-subtle">{label}</div>
      <div className="mt-1 text-fg">{value}</div>
    </div>
  );
}

/**
 * Reemplaza el `FieldRow` estático de "Closer" cuando el operador tiene
 * permiso de edición. Cambiar acá dispara `updateLead` + sync a sales — un
 * solo lead puede tener varias sales, todas heredan el nuevo dueño. El
 * dropdown incluye una opción "Sin asignar" para desasignar explícitamente.
 *
 * Miembros inactivos se listan solo si son el owner actual (para no dejarlo
 * "colgado" en el label sin poder deseleccionarlo).
 */
function CloserAssignField({
  currentOwnerId,
  teamMembers,
  assignOwnerAction,
}: {
  readonly currentOwnerId: string | null;
  readonly teamMembers: ReadonlyArray<
    Pick<TeamMemberRow, "id" | "name" | "active" | "role">
  >;
  readonly assignOwnerAction: (
    teamMemberId: string | null,
  ) => Promise<{ ok: true } | { error: string }>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const selectable = teamMembers.filter(
    (t) => t.active || t.id === currentOwnerId,
  );

  return (
    <div className="rounded-md border border-border bg-surface/40 px-3 py-2">
      <div className="uppercase tracking-wide text-fg-subtle">Closer</div>
      <Select
        value={currentOwnerId ?? ""}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value === "" ? null : e.target.value;
          if (next === currentOwnerId) return;
          setError(null);
          startTransition(async () => {
            const res = await assignOwnerAction(next);
            if ("error" in res) setError(res.error);
          });
        }}
        className="mt-1 w-full !border-0 !bg-transparent !px-0 !py-0 !text-fg"
      >
        <option value="">Sin asignar</option>
        {selectable.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
            {!t.active ? " (inactivo)" : ""}
          </option>
        ))}
      </Select>
      {error && (
        <div className="mt-1 text-[10px] text-error">{error}</div>
      )}
    </div>
  );
}

function ClientBadge({
  classification,
}: {
  readonly classification: ClientClassification;
}) {
  const styles: Record<ClientClassification, { label: string; className: string }> = {
    bueno: {
      label: "Bueno",
      className: "bg-success/10 text-success",
    },
    regular: {
      label: "Regular",
      className: "bg-warning/15 text-warning",
    },
    malo: {
      label: "Malo",
      className: "bg-error/10 text-error",
    },
  };
  const s = styles[classification];
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.className}`}
      title="Clasificación por historial de vencimientos"
    >
      Cliente: {s.label}
    </span>
  );
}

function frequencyLabel(f: SaleRow["installment_frequency"]): string {
  switch (f) {
    case "weekly":
      return "semanal";
    case "monthly":
      return "mensual";
    default:
      return "único";
  }
}

function InstallmentsTimeline({
  statuses,
  sale,
  fxLookup,
}: {
  readonly statuses: ReadonlyArray<InstallmentStatus>;
  readonly sale: SaleRow;
  readonly fxLookup?: FxLookup;
}) {
  if (statuses.length === 0) {
    return null;
  }
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
        Cronograma de cuotas
      </h4>
      <ol className="divide-y divide-border rounded-md border border-border">
        {statuses.map((st) => (
          <InstallmentRowItem
            key={st.installment.id}
            status={st}
            sale={sale}
            fxLookup={fxLookup}
          />
        ))}
      </ol>
    </section>
  );
}

function InstallmentRowItem({
  status,
  sale,
  fxLookup,
}: {
  readonly status: InstallmentStatus;
  readonly sale: SaleRow;
  readonly fxLookup?: FxLookup;
}) {
  const { installment: inst, paid, remaining, daysOverdue, state } = status;
  const label = statusLabel(state);
  return (
    <li className="flex items-center justify-between gap-4 px-4 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <div className="font-medium text-fg">Cuota {inst.number}</div>
        <div className="text-xs text-fg-subtle">
          Vence {fmtDate(inst.due_date)}
          {state === "overdue" && (
            <span className="ml-1 text-error">
              · {daysOverdue} día{daysOverdue === 1 ? "" : "s"} de atraso
            </span>
          )}
        </div>
      </div>
      <div className="text-right text-xs">
        <div className="tabular-nums text-fg">
          {fmtSaleMoney(fxLookup, sale, paid)} /{" "}
          {fmtSaleMoney(fxLookup, sale, Number(inst.amount))}
        </div>
        {remaining > 0 && state !== "paid" && (
          <div className="text-fg-subtle">
            Saldo {fmtSaleMoney(fxLookup, sale, remaining)}
          </div>
        )}
      </div>
      <span
        className={
          "rounded-full px-2 py-0.5 text-xs font-medium " + label.className
        }
      >
        {label.text}
      </span>
    </li>
  );
}

function statusLabel(state: InstallmentStatus["state"]): {
  text: string;
  className: string;
} {
  switch (state) {
    case "paid":
      return { text: "Pagada", className: "bg-success/10 text-success" };
    case "partial":
      return { text: "Parcial", className: "bg-accent/10 text-accent" };
    case "overdue":
      return { text: "Vencida", className: "bg-error/10 text-error" };
    default:
      return { text: "Pendiente", className: "bg-surface text-fg-muted" };
  }
}

function OrphanPaymentsPanel({
  orphanPayments,
  installments,
  updateAction,
  sale,
  fxLookup,
}: {
  readonly orphanPayments: ReadonlyArray<PaymentRow>;
  readonly installments: ReadonlyArray<InstallmentRow>;
  readonly updateAction: UpdatePaymentInstallmentAction;
  readonly sale: SaleRow;
  readonly fxLookup?: FxLookup;
}) {
  return (
    <section className="space-y-2 rounded-md border border-warning/40 bg-warning/5 p-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-warning">
        Cobros sin cuota asignada ({orphanPayments.length})
      </h4>
      <p className="text-xs text-fg-muted">
        Se regeneró el plan de cuotas y estos cobros quedaron flotando.
        Elegí a qué cuota pertenece cada uno para volver a computarlos en los
        totales por cuota.
      </p>
      <ul className="space-y-2">
        {orphanPayments.map((p) => (
          <OrphanPaymentRow
            key={p.id}
            payment={p}
            installments={installments}
            updateAction={updateAction}
            sale={sale}
            fxLookup={fxLookup}
          />
        ))}
      </ul>
    </section>
  );
}

function OrphanPaymentRow({
  payment,
  installments,
  updateAction,
  sale,
  fxLookup,
}: {
  readonly payment: PaymentRow;
  readonly installments: ReadonlyArray<InstallmentRow>;
  readonly updateAction: UpdatePaymentInstallmentAction;
  readonly sale: SaleRow;
  readonly fxLookup?: FxLookup;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <li className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-fg-muted">
        {fmtDate(payment.paid_at)} ·{" "}
        <span className="tabular-nums text-fg">
          {fmtPaymentMoney(fxLookup, payment)}
        </span>
      </span>
      <Select
        aria-label="Cuota a asignar"
        disabled={pending}
        defaultValue=""
        onChange={(e) => {
          const value = e.target.value;
          if (!value) return;
          setError(null);
          startTransition(async () => {
            const r = await updateAction(payment.id, value);
            if ("error" in r) setError(r.error);
          });
        }}
        className="max-w-[16rem]"
      >
        <option value="" disabled>
          Elegí cuota…
        </option>
        {installments.map((i) => (
          <option key={i.id} value={i.id}>
            Cuota {i.number} · {fmtDate(i.due_date)} ·{" "}
            {fmtSaleMoney(fxLookup, sale, Number(i.amount))}
          </option>
        ))}
      </Select>
      {pending && <span className="text-fg-subtle">Guardando…</span>}
      {error && <FieldError>{error}</FieldError>}
    </li>
  );
}

function Card({
  label,
  value,
  hint,
  accent,
}: {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly accent?: boolean;
}) {
  return (
    <div
      className={
        "rounded-md border p-3 " +
        (accent ? "border-accent/40 bg-accent/5" : "border-border bg-surface/40")
      }
    >
      <div className="text-xs uppercase tracking-wide text-fg-subtle">
        {label}
      </div>
      <div className={"mt-1 text-lg font-bold " + (accent ? "text-accent" : "text-fg")}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-fg-muted">{hint}</div>}
    </div>
  );
}

function PaymentForm({
  installments,
  invoices,
  statuses,
  paymentMethods,
  addPaymentAction,
  onSuccess,
  methodCurrencies,
  saleCurrency,
}: {
  readonly installments: ReadonlyArray<InstallmentRow>;
  /** Facturas emitidas de la venta (una por cuota tras el paso 4). Vacío OK. */
  readonly invoices: ReadonlyArray<InvoiceOption>;
  readonly statuses: ReadonlyArray<InstallmentStatus>;
  readonly paymentMethods: ReadonlyArray<PaymentMethodRow>;
  readonly addPaymentAction: BoundAddPayment;
  /** Callback tras cargar cobro OK. Usado por el variant `add-payment` para cerrar el modal — en el flujo full se omite para permitir cargar varios cobros seguidos. */
  readonly onSuccess?: () => void;
  readonly methodCurrencies: Record<string, "ARS" | "USD">;
  /** Moneda de la venta — se usa para formatear el saldo de cada cuota con AR$/US$ en el dropdown. */
  readonly saleCurrency: Currency;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement | null>(null);

  const activeMethods = paymentMethods.filter((m) => m.active);

  // Sugerimos la próxima cuota que aún no cuenta como paga. El modelo del
  // 50% deja cuotas paid con posible saldo residual — no queremos sugerir
  // "pagar 12 pesos" de una cuota ya considerada al día. Preserva orden
  // por `number` (== due_date).
  let suggested: { installmentId: string; amount: number } | null = null;
  for (const st of statuses) {
    if (st.state !== "paid") {
      suggested = { installmentId: st.installment.id, amount: st.remaining };
      break;
    }
  }

  // `null` significa "todavía no eligió el usuario" — usamos la sugerencia.
  // Al elegir, guardamos el valor efectivo. Reset después de submit exitoso
  // vuelve a `null` para re-sugerir la próxima cuota disponible.
  const [userInstallmentId, setUserInstallmentId] = useState<string | null>(null);
  const [userAmount, setUserAmount] = useState<string | null>(null);
  const [selectedMethodId, setSelectedMethodId] = useState<string>("");
  const [selectedCurrency, setSelectedCurrency] = useState<"ARS" | "USD">(
    saleCurrency,
  );
  const installmentId = userInstallmentId ?? suggested?.installmentId ?? "";
  const amount =
    userAmount ?? (suggested ? String(suggested.amount) : "");

  // Auto-selección de factura por cuota (1 cuota = 1 factura tras el paso 4).
  // La factura viable es la EMITIDA de la cuota elegida. Si no hay (ej. venta
  // legacy sin backfill), o está cobrada/anulada, `matchedInvoice` es null y
  // el cobro se guarda sin invoice_id.
  const matchedInvoice = installmentId
    ? invoices.find(
        (i) => i.installment_id === installmentId && i.status === "emitida",
      ) ?? null
    : null;

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await addPaymentAction(null, formData);
      if (result && "error" in result) {
        setError(result.error);
        return;
      }
      formRef.current?.reset();
      setUserInstallmentId(null);
      setUserAmount(null);
      setSelectedMethodId("");
      setSelectedCurrency(saleCurrency);
      onSuccess?.();
    });
  }

  if (installments.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-surface/40 p-3 text-xs text-fg-muted">
        No hay cuotas todavía para esta venta. Editá la venta para regenerar
        el plan.
      </div>
    );
  }
  if (activeMethods.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-warning/40 bg-warning/5 p-3 text-xs text-warning">
        No hay métodos de pago activos. Pedile al admin que cargue al menos
        uno en <b>Métodos de pago</b> antes de registrar cobros.
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      action={handleSubmit}
      className="space-y-3 rounded-md border border-border bg-surface/40 p-4"
    >
      <h4 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
        Cargar cobro
      </h4>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="pay-installment">Cuota *</Label>
          <Select
            id="pay-installment"
            name="installment_id"
            value={installmentId}
            onChange={(e) => {
              const id = e.target.value;
              setUserInstallmentId(id);
              // Sugerir el saldo restante de la cuota elegida como monto.
              const st = statuses.find((s) => s.installment.id === id);
              if (st) setUserAmount(String(st.remaining));
            }}
            required
          >
            <option value="" disabled>
              Elegí una cuota
            </option>
            {statuses.map((st) => {
              const marker =
                st.state === "paid"
                  ? " · pagada"
                  : st.state === "overdue"
                    ? " · vencida"
                    : "";
              return (
                <option key={st.installment.id} value={st.installment.id}>
                  Cuota {st.installment.number} · {fmtDate(st.installment.due_date)} · saldo {fmtNative(st.remaining, saleCurrency)}
                  {marker}
                </option>
              );
            })}
          </Select>
        </div>
        <div>
          <Label htmlFor="pay-method">Método de pago *</Label>
          <Select
            id="pay-method"
            name="payment_method_id"
            value={selectedMethodId}
            required
            onChange={(e) => {
              const id = e.target.value;
              setSelectedMethodId(id);
              setSelectedCurrency(methodCurrencies[id] ?? "ARS");
            }}
          >
            <option value="" disabled>
              Elegí un método
            </option>
            {activeMethods.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div>
          <Label htmlFor="pay-amount">Monto *</Label>
          <Input
            id="pay-amount"
            name="amount"
            type="number"
            step="0.01"
            min="0.01"
            required
            value={amount}
            onChange={(e) => setUserAmount(e.target.value)}
            placeholder="100"
          />
        </div>
        <div>
          <Label>Moneda</Label>
          <div className="flex gap-1 mt-1">
            {(["ARS", "USD"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setSelectedCurrency(c)}
                className={`flex-1 rounded border px-2 py-1.5 text-xs font-medium transition-colors ${
                  selectedCurrency === c
                    ? "border-accent bg-accent text-white"
                    : "border-border bg-surface text-fg-muted hover:text-fg"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          <input type="hidden" name="original_currency" value={selectedCurrency} />
        </div>
        <div>
          <Label htmlFor="pay-date">Fecha</Label>
          <Input
            id="pay-date"
            name="paid_at"
            type="date"
            defaultValue={todayInAR()}
          />
        </div>
        <div>
          <Label htmlFor="pay-transaction">Nº de transacción</Label>
          <Input
            id="pay-transaction"
            name="transaction_number"
            placeholder="Opcional (comprobante del banco)"
          />
        </div>
        <div>
          <Label htmlFor="pay-notes">Notas</Label>
          <Input id="pay-notes" name="notes" placeholder="Opcional" />
        </div>
      </div>
      <input
        type="hidden"
        name="invoice_id"
        value={matchedInvoice?.id ?? ""}
      />
      {installmentId ? (
        <div className="text-xs text-fg-muted">
          {matchedInvoice ? (
            <>
              Se aplicará a la factura{" "}
              <b className="text-fg">{matchedInvoice.invoice_number ?? "—"}</b>{" "}
              (emitida por esta cuota).
            </>
          ) : (
            <>Sin factura emitida para esta cuota — el cobro queda sin factura vinculada.</>
          )}
        </div>
      ) : null}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Cargando…" : "+ Agregar cobro"}
        </Button>
        {error && <FieldError>{error}</FieldError>}
      </div>
    </form>
  );
}

function PaymentRowItem({
  payment,
  installments,
  paymentMethods,
  deletePaymentAction,
  updatePaymentMethodAction,
  fxLookup,
}: {
  readonly payment: PaymentRow;
  readonly installments: ReadonlyArray<InstallmentRow>;
  readonly paymentMethods: ReadonlyArray<PaymentMethodRow>;
  readonly deletePaymentAction: DeletePaymentAction;
  readonly updatePaymentMethodAction?: UpdatePaymentMethodAction;
  readonly fxLookup?: FxLookup;
}) {
  const [isPending, startTransition] = useTransition();
  const [methodPending, startMethodTransition] = useTransition();
  const [methodError, setMethodError] = useState<string | null>(null);

  const inst = installments.find((i) => i.id === payment.installment_id) ?? null;
  const method = paymentMethods.find((m) => m.id === payment.payment_method_id) ?? null;
  const activeMethods = paymentMethods.filter(
    (m) => m.active || m.id === payment.payment_method_id,
  );

  return (
    <li className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-baseline gap-2">
          <span className="font-medium tabular-nums text-fg">
            {fmtPaymentMoney(fxLookup, payment)}
          </span>
          <span className="text-xs text-fg-subtle">{fmtDate(payment.paid_at)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          <span>
            {inst ? `Cuota ${inst.number}` : (
              <span className="text-warning">Sin cuota</span>
            )}
          </span>
          <span>·</span>
          {updatePaymentMethodAction ? (
            <Select
              aria-label="Método de pago"
              disabled={methodPending}
              value={payment.payment_method_id ?? ""}
              onChange={(e) => {
                const value = e.target.value === "" ? null : e.target.value;
                setMethodError(null);
                startMethodTransition(async () => {
                  const r = await updatePaymentMethodAction(payment.id, value);
                  if ("error" in r) setMethodError(r.error);
                });
              }}
              className="max-w-[12rem] py-0.5 text-xs"
            >
              <option value="">— Sin método —</option>
              {activeMethods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {!m.active ? " (inactivo)" : ""}
                </option>
              ))}
            </Select>
          ) : (
            <span>{method?.name ?? "Sin método"}</span>
          )}
          {payment.notes && (
            <>
              <span>·</span>
              <span>{payment.notes}</span>
            </>
          )}
        </div>
        {methodError && <FieldError>{methodError}</FieldError>}
      </div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (
            !confirm(
              `¿Borrar cobro de ${fmtPaymentMoney(fxLookup, payment)}?`,
            )
          )
            return;
          startTransition(async () => {
            await deletePaymentAction(payment.id);
          });
        }}
        className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-error hover:bg-error/10 disabled:opacity-50"
      >
        ×
      </button>
    </li>
  );
}

function ProductAssign({
  currentProductId,
  currentProductName,
  products,
  updateProductAction,
}: {
  readonly currentProductId: string;
  readonly currentProductName: string;
  readonly products: ReadonlyArray<ProductRow>;
  readonly updateProductAction?: BoundUpdateProduct;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const activeProducts = products.filter(
    (p) => p.active || p.id === currentProductId,
  );

  if (!updateProductAction) {
    return (
      <section className="rounded-md border border-border bg-surface/40 px-3 py-2 text-xs">
        <div className="uppercase tracking-wide text-fg-subtle">Producto</div>
        <div className="mt-1 text-fg">{currentProductName}</div>
      </section>
    );
  }

  return (
    <section className="rounded-md border border-border bg-surface/40 px-3 py-2 text-xs">
      <div className="uppercase tracking-wide text-fg-subtle">Producto</div>
      <div className="mt-1 flex items-center gap-2">
        <Select
          aria-label="Producto asignado a la venta"
          defaultValue={currentProductId}
          disabled={pending}
          onChange={(e) => {
            const nextId = e.target.value;
            if (nextId === currentProductId) return;
            setError(null);
            startTransition(async () => {
              const result = await updateProductAction(nextId);
              if ("error" in result) setError(result.error);
            });
          }}
        >
          {activeProducts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {!p.active ? " (inactivo)" : ""}
            </option>
          ))}
        </Select>
        {pending && <span className="text-fg-subtle">Guardando…</span>}
      </div>
      {error && <FieldError>{error}</FieldError>}
    </section>
  );
}

function CommissionSnapshotBar({
  hasSnapshot,
  recalculateAction,
}: {
  readonly hasSnapshot: boolean;
  readonly recalculateAction?: BoundRecalculate;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justRecalculated, setJustRecalculated] = useState(false);

  return (
    <section className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface/40 px-3 py-2 text-xs">
      {hasSnapshot ? (
        <span className="rounded-full bg-success/10 px-2 py-0.5 text-success">
          Comisión congelada al cierre
        </span>
      ) : (
        <span className="rounded-full bg-warning/15 px-2 py-0.5 text-warning">
          Sin regla congelada (usando la vigente)
        </span>
      )}
      {recalculateAction && (
        <>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setError(null);
              setJustRecalculated(false);
              startTransition(async () => {
                const r = await recalculateAction();
                if ("error" in r) setError(r.error);
                else setJustRecalculated(true);
              });
            }}
            className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg hover:bg-bg-elevated disabled:opacity-50"
          >
            {pending ? "Recalculando…" : "Recalcular con regla actual"}
          </button>
          {justRecalculated && (
            <span className="text-success">Actualizada.</span>
          )}
          {error && <FieldError>{error}</FieldError>}
        </>
      )}
    </section>
  );
}

function EditSaleForm({
  sale,
  modalities,
  products,
  updateSaleAction,
  onCancel,
  onSuccess,
  hideCommission = false,
}: {
  readonly sale: SaleRow;
  readonly modalities: ReadonlyArray<PaymentModalityRow>;
  readonly products: ReadonlyArray<ProductRow>;
  readonly updateSaleAction: SaleAction;
  readonly onCancel: () => void;
  readonly onSuccess: () => void;
  readonly hideCommission?: boolean;
}) {
  const [state, formAction, pending] = useActionState<SaleActionState, FormData>(
    updateSaleAction,
    null,
  );

  const [totalAmount, setTotalAmount] = useState<number>(
    Number(sale.total_amount) || 0,
  );
  const [closedAt, setClosedAt] = useState<string>(sale.closed_at.slice(0, 10));

  useEffect(() => {
    if (state && "ok" in state && state.ok) onSuccess();
  }, [state, onSuccess]);

  const visibleProducts = products.filter(
    (p) => p.active || p.id === sale.product_id,
  );
  const visibleModalities = modalities.filter(
    (m) => m.active || m.id === sale.payment_modality_id,
  );

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <Label htmlFor="edit-product">Producto *</Label>
        <Select
          id="edit-product"
          name="product_id"
          required
          defaultValue={sale.product_id}
        >
          {visibleProducts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {!p.active ? " (inactivo)" : ""}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="edit-modality">Modalidad de pago *</Label>
        <Select
          id="edit-modality"
          name="payment_modality_id"
          required
          defaultValue={sale.payment_modality_id}
        >
          {visibleModalities.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {!m.active ? " (inactiva)" : ""}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr_1fr]">
        <div>
          <Label htmlFor="edit-total">Monto pactado *</Label>
          <Input
            id="edit-total"
            name="total_amount"
            type="number"
            step="0.01"
            min="0"
            required
            value={String(totalAmount)}
            onChange={(e) => setTotalAmount(parseFloat(e.target.value) || 0)}
          />
        </div>
        <div>
          <Label htmlFor="edit-currency">Moneda</Label>
          <Select
            id="edit-currency"
            name="currency"
            defaultValue={sale.currency ?? "ARS"}
          >
            <option value="ARS">Pesos (ARS)</option>
            <option value="USD">Dólares (USD)</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="edit-closed-at">Fecha de cierre</Label>
          <Input
            id="edit-closed-at"
            name="closed_at"
            type="date"
            value={closedAt}
            onChange={(e) => setClosedAt(e.target.value)}
          />
        </div>
      </div>

      <InstallmentPlanFields
        totalAmount={totalAmount}
        startDate={closedAt}
        defaultCount={sale.installment_count}
        defaultFrequency={sale.installment_frequency}
        defaultGraceDays={sale.grace_days}
      />

      <div className="rounded-md border border-warning/30 bg-warning/5 p-3 text-xs text-fg-muted">
        <b className="text-warning">Aviso:</b> si cambiás la cantidad de
        cuotas, la frecuencia, el monto o la fecha de cierre, se regenera el
        plan y todos los cobros ya cargados quedan flotando. Los podés
        re-asignar cuota por cuota desde la ficha.
      </div>

      {!hideCommission && (
        <label className="flex items-start gap-2 text-xs text-fg-muted">
          <input
            type="checkbox"
            name="regenerate"
            className="mt-0.5 accent-accent"
          />
          <span>
            Recalcular comisión con la regla actual.
            <span className="ml-1 text-fg-subtle">
              Por default el snapshot queda como estaba al cierre (Fase 7).
            </span>
          </span>
        </label>
      )}

      <div className="flex items-center gap-4 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Guardar cambios"}
        </Button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="text-xs text-fg-muted hover:text-fg disabled:opacity-50"
        >
          Cancelar
        </button>
        {state && "error" in state && <FieldError>{state.error}</FieldError>}
      </div>
    </form>
  );
}

/**
 * Cuerpo compacto para `variant="add-payment"`. Muestra un resumen mínimo de la
 * venta (producto + pactado + cobrado) para que el operador confirme que está
 * cargando el cobro donde corresponde, más el `PaymentForm` cerrado en success.
 */
function AddPaymentOnly({
  sale,
  payments,
  installments,
  invoices,
  paymentMethods,
  addPaymentAction,
  onSuccess,
  fxLookup,
  methodCurrencies,
}: {
  readonly sale: SaleRow;
  readonly payments: ReadonlyArray<PaymentRow>;
  readonly installments: ReadonlyArray<InstallmentRow>;
  readonly invoices?: ReadonlyArray<InvoiceOption>;
  readonly paymentMethods: ReadonlyArray<PaymentMethodRow>;
  readonly addPaymentAction: BoundAddPayment;
  readonly onSuccess: () => void;
  readonly fxLookup?: FxLookup;
  readonly methodCurrencies: Record<string, "ARS" | "USD">;
}) {
  const today = todayInAR();
  const statuses = useMemo(() => {
    const { normalized } = normalizePaymentsForSaleCurrency(sale, payments, fxLookup);
    return computeInstallmentStatuses(installments, normalized, sale.grace_days, today);
  }, [installments, payments, fxLookup, sale, today]);
  const collectedDisplay = collectedForSale(fxLookup, sale, payments);
  // Saldo: en moneda nativa si TODOS los cobros comparten la moneda del
  // pactado. Con mismatch usamos USD (mismo criterio que `collectedDisplay`
  // cuando mixed=true): total_amount convertido a USD − cobrado ya en USD.
  // Sumar unidades distintas es el bug que estamos previniendo.
  const totalUsd = fxLookup?.bySaleId[sale.id]?.totalUsd ?? null;
  const balanceNative = collectedDisplay.mixed
    ? null
    : Math.max(Number(sale.total_amount) - collectedDisplay.amount, 0);
  const balanceUsd =
    collectedDisplay.mixed && totalUsd !== null
      ? Math.max(totalUsd - collectedDisplay.amount, 0)
      : null;

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-surface/40 px-3 py-2 text-xs text-fg-muted">
        Pactado{" "}
        <b className="tabular-nums text-fg">
          {fmtSaleMoney(fxLookup, sale, Number(sale.total_amount))}
        </b>
        {" · "}
        Cobrado{" "}
        <b className="tabular-nums text-fg">
          {fmtCollected(collectedDisplay, fxLookup)}
        </b>
        {collectedDisplay.mixed && (
          <span
            className="ml-1 rounded bg-warning/15 px-1 py-0.5 text-[10px] font-medium text-warning"
            title="Cobros en moneda distinta al pactado. Total mostrado convertido a USD."
          >
            moneda distinta
          </span>
        )}
        {" · "}
        Saldo{" "}
        <b className="tabular-nums text-fg">
          {balanceNative !== null
            ? fmtSaleMoney(fxLookup, sale, balanceNative)
            : balanceUsd !== null
              ? fmtUsd(balanceUsd)
              : "—"}
        </b>
        {collectedDisplay.mixed && balanceUsd !== null && (
          <span className="ml-1 text-[10px] text-fg-muted">(USD)</span>
        )}
      </div>
      <PaymentForm
        installments={installments}
        invoices={invoices ?? []}
        statuses={statuses}
        paymentMethods={paymentMethods}
        addPaymentAction={addPaymentAction}
        onSuccess={onSuccess}
        methodCurrencies={methodCurrencies}
        saleCurrency={fxLookup?.bySaleId[sale.id]?.currency ?? "ARS"}
      />
    </div>
  );
}
