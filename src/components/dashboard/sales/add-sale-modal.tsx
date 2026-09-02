"use client";

import { useActionState, useEffect, useState, useTransition } from "react";

import type {
  FirstPaymentContext,
  PaymentActionState,
  SaleActionState,
} from "@/app/(app)/(kg)/proyectos/[projectId]/leads/sale-actions";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { PaymentModalityRow } from "@/lib/commissions/types";
import { fmtDate } from "@/lib/format";
import { todayInAR } from "@/lib/installments/status";
import { fmtNative } from "@/lib/money";
import type { PaymentMethodRow } from "@/lib/payment-methods/types";
import type { ProductRow } from "@/lib/products/types";
import type { TeamMemberRow } from "@/lib/team/types";

import { InstallmentPlanFields } from "./installment-plan-fields";

type CreateSaleWithLeadAction = (
  prev: SaleActionState,
  formData: FormData,
) => Promise<SaleActionState>;

type AddPaymentAction = (
  saleId: string,
  prev: PaymentActionState,
  formData: FormData,
) => Promise<PaymentActionState>;

type GetFirstPaymentContextAction = (
  saleId: string,
) => Promise<FirstPaymentContext>;

/**
 * Botón "+ Agregar venta" para la vista project-wide de Ventas. Abre un modal
 * en dos pasos:
 *
 *   1. Cargar venta   → createSaleWithLead (lead + sale + cuotas + facturas).
 *   2. Primer cobro   → addPayment sobre la cuota 1 (con auto-attach de la
 *                       factura emitida, si existe).
 *
 * Los dos pasos ocupan el mismo shell — el contenido interior se reemplaza,
 * el modal no crece hacia abajo. En el paso 2 se puede "Saltar" (deja la
 * venta sin cobro cargado) o cargar el cobro y terminar. Si el checkbox
 * "Cargar otra al guardar" quedó activo, terminar vuelve al paso 1 con el
 * form limpio para la próxima venta.
 */
export function AddSaleModal({
  launches,
  modalities,
  products,
  teamMembers,
  paymentMethods,
  methodCurrencies,
  createSaleWithLeadAction,
  addPaymentAction,
  getFirstPaymentContextAction,
}: {
  readonly launches: ReadonlyArray<{ id: string; name: string }>;
  readonly modalities: ReadonlyArray<PaymentModalityRow>;
  readonly products: ReadonlyArray<ProductRow>;
  readonly teamMembers: ReadonlyArray<
    Pick<TeamMemberRow, "id" | "name" | "active">
  >;
  readonly paymentMethods: ReadonlyArray<PaymentMethodRow>;
  readonly methodCurrencies: Record<string, "ARS" | "USD">;
  readonly createSaleWithLeadAction: CreateSaleWithLeadAction;
  readonly addPaymentAction: AddPaymentAction;
  readonly getFirstPaymentContextAction: GetFirstPaymentContextAction;
}) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [keepOpen, setKeepOpen] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [step, setStep] = useState<
    | { kind: "sale" }
    | {
        kind: "loading-context";
        saleId: string;
      }
    | {
        kind: "payment";
        saleId: string;
        saleCurrency: "ARS" | "USD";
        firstInstallment: {
          id: string;
          number: number;
          amount: number;
          dueDate: string;
        };
        emittedInvoice: {
          id: string;
          invoiceNumber: string | null;
        } | null;
      }
    | { kind: "context-error"; saleId: string; error: string }
  >({ kind: "sale" });

  function resetToStep1() {
    setStep({ kind: "sale" });
    setFormKey((k) => k + 1);
  }

  function finish() {
    setSavedCount((n) => n + 1);
    if (keepOpen) {
      resetToStep1();
    } else {
      setOpen(false);
    }
  }

  async function transitionToPayment(saleId: string) {
    setStep({ kind: "loading-context", saleId });
    const ctx = await getFirstPaymentContextAction(saleId);
    if ("error" in ctx) {
      setStep({ kind: "context-error", saleId, error: ctx.error });
      return;
    }
    setStep({
      kind: "payment",
      saleId,
      saleCurrency: ctx.saleCurrency,
      firstInstallment: ctx.firstInstallment,
      emittedInvoice: ctx.emittedInvoice,
    });
  }

  const stepLabel =
    step.kind === "sale"
      ? "Paso 1 de 2 · Venta"
      : step.kind === "payment"
        ? "Paso 2 de 2 · Primer cobro"
        : step.kind === "loading-context"
          ? "Paso 2 de 2 · Cargando…"
          : "Paso 2 de 2 · Error";

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setSavedCount(0);
          setKeepOpen(false);
          resetToStep1();
          setOpen(true);
        }}
        className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
      >
        + Agregar venta
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 sm:p-6"
          onClick={(e) => {
            // Solo cerrar por click en el backdrop cuando NO estamos entre pasos
            // (evita cerrar accidentalmente y perder el saleId sin cobro cargado).
            if (e.target === e.currentTarget && step.kind === "sale") {
              setOpen(false);
            }
          }}
        >
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-md border border-border bg-bg-elevated shadow-card">
            <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
              <div>
                <h3 className="text-lg font-bold text-fg">Cargar venta</h3>
                <p className="mt-0.5 text-xs text-fg-subtle">
                  <span className="text-fg-muted">{stepLabel}</span>
                  {savedCount > 0 && step.kind === "sale" && (
                    <>
                      {" · "}
                      {savedCount} venta{savedCount === 1 ? "" : "s"} cargada
                      {savedCount === 1 ? "" : "s"} en esta sesión.
                    </>
                  )}
                </p>
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

            <div className="flex-1 overflow-y-auto px-6 py-6">
              {step.kind === "sale" && (
                <AddSaleForm
                  key={formKey}
                  launches={launches}
                  modalities={modalities}
                  products={products}
                  teamMembers={teamMembers}
                  createSaleWithLeadAction={createSaleWithLeadAction}
                  keepOpen={keepOpen}
                  setKeepOpen={setKeepOpen}
                  onSuccess={(saleId) => {
                    if (saleId) {
                      void transitionToPayment(saleId);
                    } else {
                      // Fallback: sin saleId (no debería pasar). Terminá igual.
                      finish();
                    }
                  }}
                />
              )}
              {step.kind === "loading-context" && (
                <div className="rounded-md border border-dashed border-border bg-surface/40 p-6 text-center text-sm text-fg-muted">
                  Preparando el primer cobro…
                </div>
              )}
              {step.kind === "context-error" && (
                <div className="space-y-3">
                  <div className="rounded-md border border-warning/40 bg-warning/5 p-4 text-sm text-warning">
                    La venta se guardó pero no pude cargar la cuota:{" "}
                    {step.error}
                  </div>
                  <div className="flex items-center gap-3">
                    <Button type="button" onClick={finish}>
                      Terminar sin primer cobro
                    </Button>
                  </div>
                </div>
              )}
              {step.kind === "payment" && (
                <FirstPaymentForm
                  saleId={step.saleId}
                  saleCurrency={step.saleCurrency}
                  firstInstallment={step.firstInstallment}
                  emittedInvoice={step.emittedInvoice}
                  paymentMethods={paymentMethods}
                  methodCurrencies={methodCurrencies}
                  addPaymentAction={addPaymentAction}
                  onDone={finish}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function AddSaleForm({
  launches,
  modalities,
  products,
  teamMembers,
  createSaleWithLeadAction,
  keepOpen,
  setKeepOpen,
  onSuccess,
}: {
  readonly launches: ReadonlyArray<{ id: string; name: string }>;
  readonly modalities: ReadonlyArray<PaymentModalityRow>;
  readonly products: ReadonlyArray<ProductRow>;
  readonly teamMembers: ReadonlyArray<
    Pick<TeamMemberRow, "id" | "name" | "active">
  >;
  readonly createSaleWithLeadAction: CreateSaleWithLeadAction;
  readonly keepOpen: boolean;
  readonly setKeepOpen: (v: boolean) => void;
  readonly onSuccess: (saleId: string | undefined) => void;
}) {
  const [state, formAction, pending] = useActionState<
    SaleActionState,
    FormData
  >(createSaleWithLeadAction, null);

  const today = todayInAR();
  const [totalAmount, setTotalAmount] = useState<number>(0);
  const [closedAt, setClosedAt] = useState<string>(today);

  useEffect(() => {
    if (state && "ok" in state && state.ok) onSuccess(state.saleId);
  }, [state, onSuccess]);

  const activeModalities = modalities.filter((m) => m.active);
  const activeProducts = products.filter((p) => p.active);
  const activeClosers = teamMembers.filter((t) => t.active);

  if (activeModalities.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-surface/40 p-4 text-sm text-fg-muted">
        No hay modalidades de pago configuradas. Pedile al admin que las cargue
        en <b>Comisiones</b> antes de registrar ventas.
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1.2fr_1fr_1.4fr]">
        <div>
          <Label htmlFor="add-sale-lead-name">Alumno *</Label>
          <Input
            id="add-sale-lead-name"
            name="lead_name"
            required
            placeholder="Nombre del alumno"
            autoFocus
          />
        </div>
        <div>
          <Label htmlFor="add-sale-lead-phone">Teléfono</Label>
          <Input
            id="add-sale-lead-phone"
            name="lead_phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="11 5555-5555"
          />
        </div>
        <div>
          <Label htmlFor="add-sale-lead-email">Email</Label>
          <Input
            id="add-sale-lead-email"
            name="lead_email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="alumno@mail.com"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="add-sale-launch">Lanzamiento</Label>
          <Select id="add-sale-launch" name="launch_id" defaultValue="">
            <option value="">Sin asignar</option>
            {launches.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="add-sale-closer">Vendedor</Label>
          <Select id="add-sale-closer" name="team_member_id" defaultValue="">
            <option value="">Sin asignar</option>
            {activeClosers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="add-sale-product">Producto *</Label>
          <Select
            id="add-sale-product"
            name="product_id"
            required
            defaultValue=""
          >
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
          <Label htmlFor="add-sale-modality">Modalidad de pago *</Label>
          <Select
            id="add-sale-modality"
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
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr_1fr]">
        <div>
          <Label htmlFor="add-sale-total">Monto pactado *</Label>
          <Input
            id="add-sale-total"
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
          <Label htmlFor="add-sale-currency">Moneda</Label>
          <Select
            id="add-sale-currency"
            name="currency"
            defaultValue="ARS"
          >
            <option value="ARS">Pesos (ARS)</option>
            <option value="USD">Dólares (USD)</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="add-sale-closed-at">Fecha de cierre</Label>
          <Input
            id="add-sale-closed-at"
            name="closed_at"
            type="date"
            defaultValue={today}
            onChange={(e) => setClosedAt(e.target.value)}
          />
        </div>
      </div>

      <InstallmentPlanFields totalAmount={totalAmount} startDate={closedAt} />

      <div className="flex flex-wrap items-center gap-4 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Registrando…" : "Guardar y cargar cobro →"}
        </Button>
        <label className="flex items-center gap-2 text-xs text-fg-muted">
          <input
            type="checkbox"
            checked={keepOpen}
            onChange={(e) => setKeepOpen(e.target.checked)}
          />
          Cargar otra venta al terminar
        </label>
        {state && "error" in state && <FieldError>{state.error}</FieldError>}
      </div>
    </form>
  );
}

/**
 * Formulario simplificado para el primer cobro dentro del wizard. A
 * diferencia del `PaymentForm` de SaleModal, acá la cuota está fijada
 * (siempre la primera generada al crear la venta) y no hay un panel de
 * estado de cuotas — es el paso siguiente del wizard, no una vista de
 * gestión. La factura emitida se auto-attach vía input hidden.
 */
function FirstPaymentForm({
  saleId,
  saleCurrency,
  firstInstallment,
  emittedInvoice,
  paymentMethods,
  methodCurrencies,
  addPaymentAction,
  onDone,
}: {
  readonly saleId: string;
  readonly saleCurrency: "ARS" | "USD";
  readonly firstInstallment: {
    id: string;
    number: number;
    amount: number;
    dueDate: string;
  };
  readonly emittedInvoice: {
    id: string;
    invoiceNumber: string | null;
  } | null;
  readonly paymentMethods: ReadonlyArray<PaymentMethodRow>;
  readonly methodCurrencies: Record<string, "ARS" | "USD">;
  readonly addPaymentAction: AddPaymentAction;
  readonly onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState<string>(
    String(firstInstallment.amount),
  );
  const [methodId, setMethodId] = useState<string>("");
  const [selectedCurrency, setSelectedCurrency] = useState<"ARS" | "USD">(
    saleCurrency,
  );

  const activeMethods = paymentMethods.filter((m) => m.active);

  if (activeMethods.length === 0) {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-warning/40 bg-warning/5 p-4 text-sm text-warning">
          No hay métodos de pago activos. Pedile al admin que cargue al menos
          uno en <b>Métodos de pago</b> antes de registrar cobros. La venta ya
          quedó guardada.
        </div>
        <div>
          <Button type="button" onClick={onDone}>
            Terminar
          </Button>
        </div>
      </div>
    );
  }

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await addPaymentAction(saleId, null, formData);
      if (result && "error" in result) {
        setError(result.error);
        return;
      }
      onDone();
    });
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      <div className="rounded-md border border-border bg-surface/40 p-3 text-xs text-fg-muted">
        Venta guardada. Cargá el primer cobro sobre la{" "}
        <b className="text-fg">cuota {firstInstallment.number}</b>{" "}
        (vence {fmtDate(firstInstallment.dueDate)}, saldo{" "}
        {fmtNative(firstInstallment.amount, saleCurrency)}), o saltalo si el
        alumno todavía no pagó.
      </div>

      <input type="hidden" name="installment_id" value={firstInstallment.id} />
      <input
        type="hidden"
        name="invoice_id"
        value={emittedInvoice?.id ?? ""}
      />
      <input
        type="hidden"
        name="original_currency"
        value={selectedCurrency}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="first-pay-method">Método de pago *</Label>
          <Select
            id="first-pay-method"
            name="payment_method_id"
            value={methodId}
            required
            onChange={(e) => {
              const id = e.target.value;
              setMethodId(id);
              setSelectedCurrency(methodCurrencies[id] ?? saleCurrency);
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
        <div>
          <Label htmlFor="first-pay-date">Fecha</Label>
          <Input
            id="first-pay-date"
            name="paid_at"
            type="date"
            defaultValue={todayInAR()}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_2fr]">
        <div>
          <Label htmlFor="first-pay-amount">Monto *</Label>
          <Input
            id="first-pay-amount"
            name="amount"
            type="number"
            step="0.01"
            min="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div>
          <Label>Moneda</Label>
          <div className="mt-1 flex gap-1">
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
        </div>
        <div>
          <Label htmlFor="first-pay-transaction">Nº de transacción</Label>
          <Input
            id="first-pay-transaction"
            name="transaction_number"
            placeholder="Opcional (comprobante del banco)"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="first-pay-notes">Notas</Label>
        <Input id="first-pay-notes" name="notes" placeholder="Opcional" />
      </div>

      {emittedInvoice && (
        <div className="text-xs text-fg-muted">
          Se aplicará a la factura{" "}
          <b className="text-fg">{emittedInvoice.invoiceNumber ?? "—"}</b>{" "}
          (emitida por esta cuota).
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Cargando…" : "Cargar cobro y terminar"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onDone}
          disabled={pending}
        >
          Saltar cobro
        </Button>
        {error && <FieldError>{error}</FieldError>}
      </div>
    </form>
  );
}
