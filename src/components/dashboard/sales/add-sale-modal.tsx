"use client";

import {
  useActionState,
  useEffect,
  useState,
  useTransition,
  type CSSProperties,
} from "react";

import type {
  FirstPaymentContext,
  PaymentActionState,
  SaleActionState,
} from "@/app/(app)/(kg)/proyectos/[projectId]/leads/sale-actions";
import { Drawer } from "@/components/kg/drawer";
import { EmptyState } from "@/components/kg/empty-state";
import {
  ErrorBanner,
  Field,
  inputStyle,
  primaryBtn,
  secondaryBtn,
} from "@/components/kg/form-primitives";
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
 * Igual que en `sale-modal.tsx`: los `<select>` nativos no respetan el alto
 * que da el padding de `inputStyle` en todos los browsers, así que fijamos
 * el target de toque mínimo (36px) a mano.
 */
const controlStyle: CSSProperties = { ...inputStyle, minHeight: 36 };

/** Caja de aviso/resumen dentro del cuerpo del drawer. */
const subCardStyle: CSSProperties = {
  borderRadius: "var(--kg-r-12)",
  border: "1px solid var(--kg-border-subtle)",
  background: "var(--kg-surface-2-solid)",
  padding: 14,
};

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
 *
 * ─────────────────────────────────────────────────────────────────────────
 * MIGRACIÓN KG — qué cambió y qué NO
 * ─────────────────────────────────────────────────────────────────────────
 * Cambió el chasis (overlay propio → `Drawer`) y los estilos (`Button` /
 * `Input` / `Label` / `Select` / `FieldError` de `components/ui` → `Field` +
 * `inputStyle` + `primaryBtn`/`secondaryBtn` + `ErrorBanner` + `EmptyState`).
 * La máquina de pasos (`step`), el `formKey` que remonta el form, el
 * `keepOpen`, el `savedCount` y las dos server actions quedaron intactos.
 *
 * ÚNICA diferencia de comportamiento del chasis: antes el click en el
 * backdrop sólo cerraba durante el paso 1 (guarda contra cerrar sin cargar
 * el primer cobro). `Drawer` tiene UN solo `onClose` compartido por el
 * backdrop, la tecla Esc y la ✕ del header, así que la guarda no se puede
 * expresar sin dejar la ✕ inerte en el paso 2 —que sería peor—. Se prioriza
 * que siempre haya salida: la venta en el paso 2 YA está guardada, sólo se
 * pierde el primer cobro opcional (que igual tiene su botón "Saltar cobro").
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

  const subtitle =
    savedCount > 0 && step.kind === "sale"
      ? `${stepLabel} · ${savedCount} venta${savedCount === 1 ? "" : "s"} cargada${savedCount === 1 ? "" : "s"} en esta sesión.`
      : stepLabel;

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
        className="kg-focus"
        style={{ ...primaryBtn, minHeight: 36, whiteSpace: "nowrap" }}
      >
        + Agregar venta
      </button>

      {/*
        El wizard es un solo form por paso, pero los botones NO bajan al
        `footer` del Drawer: en el paso 2 conviven "Cargar cobro y terminar"
        (submit del form) con "Saltar cobro" (acción del wizard), y el paso
        de error tiene su propio "Terminar". Cada botón se queda con el
        bloque que lo explica — mismo criterio que `config-modal.tsx`.
      */}
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Cargar venta"
        subtitle={subtitle}
        width={820}
      >
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
          <EmptyState
            title="Preparando el primer cobro…"
            hint="Buscando la cuota 1 y su factura emitida."
          />
        )}
        {step.kind === "context-error" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Aviso, no error de submit: la venta SÍ se guardó. */}
            <ErrorBanner
              tone="warning"
              message={`La venta se guardó pero no pude cargar la cuota: ${step.error}`}
            />
            <div>
              <button
                type="button"
                onClick={finish}
                className="kg-focus w-full md:w-auto"
                style={{ ...primaryBtn, minHeight: 40 }}
              >
                Terminar sin primer cobro
              </button>
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
      </Drawer>
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
      <EmptyState
        title="Sin modalidades de pago"
        hint="Pedile al admin que las cargue en Comisiones antes de registrar ventas."
      />
    );
  }
  if (activeProducts.length === 0) {
    return (
      <EmptyState
        title="Sin productos configurados"
        hint="Pedile al admin que cargue el catálogo en Productos antes de registrar ventas."
      />
    );
  }

  return (
    <form
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      {/* Mobile primero: todo apilado en 390px, columnas recién en md+. */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1.2fr_1fr_1.4fr]">
        <Field label="Alumno" htmlFor="add-sale-lead-name" required>
          <input
            id="add-sale-lead-name"
            name="lead_name"
            required
            placeholder="Nombre del alumno"
            autoFocus
            style={controlStyle}
          />
        </Field>
        <Field label="Teléfono" htmlFor="add-sale-lead-phone">
          <input
            id="add-sale-lead-phone"
            name="lead_phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="11 5555-5555"
            style={controlStyle}
          />
        </Field>
        <Field label="Email" htmlFor="add-sale-lead-email">
          <input
            id="add-sale-lead-email"
            name="lead_email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="alumno@mail.com"
            style={controlStyle}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Lanzamiento" htmlFor="add-sale-launch">
          <select
            id="add-sale-launch"
            name="launch_id"
            defaultValue=""
            style={controlStyle}
          >
            <option value="">Sin asignar</option>
            {launches.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Vendedor" htmlFor="add-sale-closer">
          <select
            id="add-sale-closer"
            name="team_member_id"
            defaultValue=""
            style={controlStyle}
          >
            <option value="">Sin asignar</option>
            {activeClosers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Producto" htmlFor="add-sale-product" required>
          <select
            id="add-sale-product"
            name="product_id"
            required
            defaultValue=""
            style={controlStyle}
          >
            <option value="" disabled>
              Elegí un producto
            </option>
            {activeProducts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Modalidad de pago" htmlFor="add-sale-modality" required>
          <select
            id="add-sale-modality"
            name="payment_modality_id"
            required
            defaultValue=""
            style={controlStyle}
          >
            <option value="" disabled>
              Elegí una modalidad
            </option>
            {activeModalities.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[2fr_1fr_1fr]">
        <Field label="Monto pactado" htmlFor="add-sale-total" required>
          <input
            id="add-sale-total"
            name="total_amount"
            type="number"
            step="0.01"
            min="0"
            required
            placeholder="Ej: 1000"
            className="kg-num"
            onChange={(e) => setTotalAmount(parseFloat(e.target.value) || 0)}
            style={controlStyle}
          />
        </Field>
        <Field label="Moneda" htmlFor="add-sale-currency">
          <select
            id="add-sale-currency"
            name="currency"
            defaultValue="ARS"
            style={controlStyle}
          >
            <option value="ARS">Pesos (ARS)</option>
            <option value="USD">Dólares (USD)</option>
          </select>
        </Field>
        <Field label="Fecha de cierre" htmlFor="add-sale-closed-at">
          <input
            id="add-sale-closed-at"
            name="closed_at"
            type="date"
            defaultValue={today}
            onChange={(e) => setClosedAt(e.target.value)}
            style={controlStyle}
          />
        </Field>
      </div>

      <InstallmentPlanFields totalAmount={totalAmount} startDate={closedAt} />

      {state && "error" in state && <ErrorBanner message={state.error} />}

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
        <button
          type="submit"
          disabled={pending}
          className="kg-focus"
          style={{
            ...primaryBtn,
            minHeight: 40,
            opacity: pending ? 0.7 : 1,
            cursor: pending ? "not-allowed" : "pointer",
          }}
        >
          {pending ? "Registrando…" : "Guardar y cargar cobro →"}
        </button>
        <label
          htmlFor="add-sale-keep-open"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            minHeight: 36,
            fontSize: 12,
            color: "var(--kg-text-2)",
            cursor: "pointer",
          }}
        >
          <input
            id="add-sale-keep-open"
            type="checkbox"
            checked={keepOpen}
            onChange={(e) => setKeepOpen(e.target.checked)}
            style={{ cursor: "pointer", accentColor: "var(--kg-accent-500)" }}
          />
          Cargar otra venta al terminar
        </label>
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
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Aviso (la venta ya está guardada), no error de submit. */}
        <ErrorBanner
          tone="warning"
          message="No hay métodos de pago activos. Pedile al admin que cargue al menos uno en Métodos de pago antes de registrar cobros. La venta ya quedó guardada."
        />
        <div>
          <button
            type="button"
            onClick={onDone}
            className="kg-focus w-full md:w-auto"
            style={{ ...primaryBtn, minHeight: 40 }}
          >
            Terminar
          </button>
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
    <form
      action={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <div className="kg-t6" style={{ ...subCardStyle, color: "var(--kg-text-3)" }}>
        Venta guardada. Cargá el primer cobro sobre la{" "}
        <b style={{ color: "var(--kg-text-1)" }}>
          cuota {firstInstallment.number}
        </b>{" "}
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

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Método de pago" htmlFor="first-pay-method" required>
          <select
            id="first-pay-method"
            name="payment_method_id"
            value={methodId}
            required
            onChange={(e) => {
              const id = e.target.value;
              setMethodId(id);
              setSelectedCurrency(methodCurrencies[id] ?? saleCurrency);
            }}
            style={controlStyle}
          >
            <option value="" disabled>
              Elegí un método
            </option>
            {activeMethods.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Fecha" htmlFor="first-pay-date">
          <input
            id="first-pay-date"
            name="paid_at"
            type="date"
            defaultValue={todayInAR()}
            style={controlStyle}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_2fr]">
        <Field label="Monto" htmlFor="first-pay-amount" required>
          <input
            id="first-pay-amount"
            name="amount"
            type="number"
            step="0.01"
            min="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="kg-num"
            style={controlStyle}
          />
        </Field>
        <div>
          {/*
            Dos botones, no un control único: label de grupo en vez de
            `Field`. El valor sigue viajando por el hidden `original_currency`
            de más arriba — mismo `name`, mismo FormData.
          */}
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-3)", marginBottom: 6 }}
          >
            Moneda
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {(["ARS", "USD"] as const).map((c) => {
              const active = selectedCurrency === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setSelectedCurrency(c)}
                  aria-pressed={active}
                  className="kg-focus"
                  style={{
                    flex: 1,
                    minHeight: 36,
                    borderRadius: "var(--kg-r-8)",
                    border: `1px solid ${active ? "var(--kg-accent-500)" : "var(--kg-border-subtle)"}`,
                    background: active
                      ? "var(--kg-accent-halo)"
                      : "var(--kg-surface-2-solid)",
                    color: active ? "var(--kg-accent-text)" : "var(--kg-text-2)",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all var(--kg-dur) var(--kg-ease)",
                  }}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>
        <Field label="Nº de transacción" htmlFor="first-pay-transaction">
          <input
            id="first-pay-transaction"
            name="transaction_number"
            placeholder="Opcional (comprobante del banco)"
            style={controlStyle}
          />
        </Field>
      </div>

      <Field label="Notas" htmlFor="first-pay-notes">
        <input
          id="first-pay-notes"
          name="notes"
          placeholder="Opcional"
          style={controlStyle}
        />
      </Field>

      {emittedInvoice && (
        <div className="kg-t6" style={{ color: "var(--kg-text-3)" }}>
          Se aplicará a la factura{" "}
          <b style={{ color: "var(--kg-text-1)" }}>
            {emittedInvoice.invoiceNumber ?? "—"}
          </b>{" "}
          (emitida por esta cuota).
        </div>
      )}

      {error && <ErrorBanner message={error} />}

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
        <button
          type="submit"
          disabled={pending}
          className="kg-focus"
          style={{
            ...primaryBtn,
            minHeight: 40,
            opacity: pending ? 0.7 : 1,
            cursor: pending ? "not-allowed" : "pointer",
          }}
        >
          {pending ? "Cargando…" : "Cargar cobro y terminar"}
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={pending}
          className="kg-focus"
          style={{
            ...secondaryBtn,
            minHeight: 40,
            opacity: pending ? 0.5 : 1,
          }}
        >
          Saltar cobro
        </button>
      </div>
    </form>
  );
}
