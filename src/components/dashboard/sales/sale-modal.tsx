"use client";

import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type ReactNode,
} from "react";

import type {
  PaymentActionState,
  SaleActionState,
} from "@/app/(app)/(kg)/proyectos/[projectId]/leads/sale-actions";
import { KgConfirmDialog } from "@/components/kg/confirm-dialog";
import { Drawer } from "@/components/kg/drawer";
import { EmptyState } from "@/components/kg/empty-state";
import {
  ErrorBanner,
  Field,
  dangerBtn,
  inputStyle,
  primaryBtn,
  secondaryBtn,
  smallBtn,
} from "@/components/kg/form-primitives";
import { StatRow } from "@/components/kg/stat-row";
import { StatusPill } from "@/components/kg/status-pill";
import { KgTabsSelect } from "@/components/kg/tabs-bar-view";
import { TONE_VAR } from "@/components/kg/tone";
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

// ─── Estilos locales de la migración KG ────────────────────────────────────

/**
 * `inputStyle` da ~38px con su padding, pero los `<select>` nativos calculan
 * su alto con la fuente del sistema y en Android caen por debajo del target
 * de toque. Igual que en `launch-form.tsx`, fijamos 36 explícito.
 */
const controlStyle: CSSProperties = { ...inputStyle, minHeight: 36 };

/**
 * Select "desnudo": el de asignar closer/método/producto vive DENTRO de una
 * tarjeta de datos y antes se dibujaba sin caja (`!border-0 !bg-transparent`).
 * Mantiene el target de toque de 36px pero no repite el marco de la tarjeta.
 */
const bareSelectStyle: CSSProperties = {
  ...controlStyle,
  background: "transparent",
  border: "1px solid transparent",
  padding: "6px 0",
  color: "var(--kg-text-1)",
};

/** Caja de sub-bloque dentro del cuerpo del drawer (form de cobro, avisos). */
const subCardStyle: CSSProperties = {
  borderRadius: "var(--kg-r-12)",
  border: "1px solid var(--kg-border-subtle)",
  background: "var(--kg-surface-2-solid)",
  padding: 14,
};

/** Lista con divisores — reemplaza `divide-y divide-border` de Tailwind. */
const listStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  borderRadius: "var(--kg-r-12)",
  border: "1px solid var(--kg-border-subtle)",
  overflow: "hidden",
};

/** Título de sección — mismo idiom que `FormSection` de `launch-form.tsx`. */
function SectionTitle({
  children,
  actions,
}: {
  readonly children: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 8,
      }}
    >
      <h4 className="kg-t7" style={{ margin: 0, color: "var(--kg-accent-text)" }}>
        {children}
      </h4>
      {actions}
    </div>
  );
}

/** Bloque vertical con gap — reemplaza `space-y-*`. */
function Stack({
  gap = 12,
  children,
}: {
  readonly gap?: number;
  readonly children: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap }}>{children}</div>
  );
}

/**
 * Modal que sirve tanto para "cargar venta" como para la ficha completa del
 * alumno (Fase 11). Encabezado en modo `list` muestra closer + producto +
 * modalidad + fecha cierre + % cobrado + badge bueno/regular/malo del alumno.
 *
 * Cuotas (installments) son la unidad de trabajo de los cobros: cada payment
 * se linkea a una cuota puntual. Al regenerar el plan (cambiar cantidad o
 * frecuencia), los payments quedan huérfanos y el operador los re-asigna
 * desde la lista de cobros.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * MIGRACIÓN KG — qué cambió y qué NO
 * ─────────────────────────────────────────────────────────────────────────
 * Cambió SOLO el chasis y los estilos: el overlay propio (`fixed inset-0` +
 * caja `max-h-[90vh]` con tokens viejos `bg-bg-elevated`/`border-border`)
 * pasó a `Drawer`, y `Button`/`Input`/`Label`/`Select`/`FieldError` de
 * `components/ui` a `Field` + `inputStyle` + los botones de
 * `form-primitives` + `ErrorBanner`. Los badges pasaron a `StatusPill`, los
 * vacíos a `EmptyState`, el bloque de datos de la ficha a `StatRow` y los
 * dos `confirm()` nativos a `KgConfirmDialog`.
 *
 * NO cambió NADA de la lógica: mismos `name` de campo, mismas validaciones,
 * mismos cálculos de comisión / cuotas / FX y las mismas server actions con
 * los mismos gates (`updateSaleAction`, `deleteSaleAction`, etc. siguen
 * siendo opcionales y siguen decidiendo qué se muestra).
 */
export interface SaleModalProps {
  readonly triggerLabel: string;
  readonly triggerClassName?: string;
  /**
   * Estilo inline del trigger. AGREGADO en la migración KG (opcional, no
   * rompe a nadie): el kanban migrado tenía que expresar `smallBtn` con
   * Tailwind de valores arbitrarios (`border-[var(--kg-border-subtle)]`…)
   * porque acá sólo había `triggerClassName`. Con esto, un call site puede
   * pasar directo las primitivas de `form-primitives`.
   *
   * Convive con `triggerClassName`: si llegan los dos, la clase se aplica
   * igual (útil para responsive/utilidades) y el estilo va por `style`.
   */
  readonly triggerStyle?: CSSProperties;
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
}

/**
 * Modo inicial: si el lead no tiene ninguna venta, el modal abre directo en
 * el form de alta. Idéntico al `setMode(sales.length === 0 ? "new" : "list")`
 * que hacía el `useEffect` de apertura.
 */
function initialModeFor(
  sales: ReadonlyArray<SaleRow>,
): "list" | "new" | "edit" {
  return sales.length === 0 ? "new" : "list";
}

/** Venta pre-seleccionada: la pedida por prop si existe, si no la primera. */
function initialSelectedIdFor(
  sales: ReadonlyArray<SaleRow>,
  initialSaleId: string | undefined,
): string | null {
  if (sales.length === 0) return null;
  if (initialSaleId && sales.some((s) => s.id === initialSaleId)) {
    return initialSaleId;
  }
  return sales[0]!.id;
}

export function SaleModal(props: SaleModalProps) {
  const { triggerLabel, triggerClassName, triggerStyle, triggerAriaLabel } = props;
  const [open, setOpen] = useState(false);

  return (
    <>
      {/*
        El contrato del trigger NO cambia: si el call site pasa
        `triggerClassName`, sus clases siguen siendo las únicas que se
        aplican (los 3 consumidores actuales dependen de eso — ej. el link
        subrayado de la tabla de cobros, que no debe volverse pill). El
        estilo inline sólo aparece si lo piden explícito con `triggerStyle`,
        o —cuando no llega ninguno de los dos— como default KG.
      */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={triggerAriaLabel}
        title={triggerAriaLabel}
        className={`kg-focus${triggerClassName ? ` ${triggerClassName}` : ""}`}
        style={
          triggerStyle ??
          (triggerClassName
            ? undefined
            : { ...smallBtn, minHeight: 36, whiteSpace: "nowrap" })
        }
      >
        {triggerLabel}
      </button>

      {/*
        El cuerpo se monta recién al abrir y se desmonta al cerrar. Eso es lo
        que resetea `mode`/`selectedSaleId` entre aperturas — antes lo hacía
        un `useEffect` con `setState` adentro, que es error de ESLint
        (`react-hooks/set-state-in-effect`). Mismo patrón que `ConfirmBody`
        en `KgConfirmDialog`.
      */}
      {open && <SaleModalBody {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function SaleModalBody({
  onClose,
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
}: SaleModalProps & { readonly onClose: () => void }) {
  const [mode, setMode] = useState<"list" | "new" | "edit">(() =>
    initialModeFor(sales),
  );
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(() =>
    initialSelectedIdFor(sales, initialSaleId),
  );

  /*
   * Re-adopción de props en estado, en RENDER (no en un efecto — ESLint lo
   * prohíbe; ver `editable-grid.tsx`). El `useEffect` viejo tenía
   * `[open, sales, initialSaleId]` como deps: además de correr al abrir,
   * corría cada vez que el server revalidaba y mandaba un `sales` nuevo. De
   * eso depende un flujo real: al borrar una de dos ventas, `onSaleDeleted`
   * pone `selectedSaleId = null` y es esta re-adopción la que vuelve a
   * seleccionar la venta que quedó (si no, el modal se queda en "Elegí una
   * venta" sin selector que tocar). El token de identidad es la referencia
   * del array, exactamente lo que comparaba el array de deps.
   */
  const [salesToken, setSalesToken] = useState<ReadonlyArray<SaleRow>>(sales);
  const [initialSaleIdToken, setInitialSaleIdToken] = useState(initialSaleId);
  if (salesToken !== sales || initialSaleIdToken !== initialSaleId) {
    setSalesToken(sales);
    setInitialSaleIdToken(initialSaleId);
    setMode(initialModeFor(sales));
    setSelectedSaleId(initialSelectedIdFor(sales, initialSaleId));
  }

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
    /*
      Drawer en vez del modal centrado propio: trae Esc-to-close,
      click-outside, header con título + subtítulo (el nombre del alumno) y
      cuerpo con scroll — el mismo contrato que había, sin markup a mano. En
      390px ocupa el ancho completo (antes el modal centrado con `p-4` dejaba
      ~358px útiles para una ficha con tablas). El variant compacto de cobro
      va más angosto porque sólo tiene un form corto.
    */
    <Drawer
      open
      onClose={onClose}
      title={headerTitle}
      subtitle={lead.name}
      width={variant === "add-payment" ? 560 : 820}
    >
      <Stack gap={20}>
        {variant === "full" && mode === "list" && sales.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 8,
            }}
          >
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
                className="kg-focus"
                style={{ ...smallBtn, marginLeft: "auto", minHeight: 36 }}
              >
                + Nueva venta
              </button>
            )}
          </div>
        )}

        <div>
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
                onSuccess={onClose}
                fxLookup={fxLookup}
                methodCurrencies={methodCurrencies ?? {}}
              />
            ) : (
              <EmptyState
                title="Sin venta cargada"
                hint="Este alumno todavía no tiene una venta a la que imputar el cobro."
              />
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
                else onClose();
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
                  onClose();
                }
              }}
              fxLookup={fxLookup}
              hideCommission={hideCommission}
            />
          ) : (
            <EmptyState
              title="Ninguna venta seleccionada"
              hint="Elegí una venta del selector de arriba para ver su ficha."
            />
          )}
        </div>
      </Stack>
    </Drawer>
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
  /*
   * Las pestañas son `KgTabsSelect`: la variante del DS que NO navega. Elegir
   * una venta vive en estado local del drawer — un `<Link>` cerraría el
   * drawer y perdería el modo de edición. Antes acá se replicaba la pill del
   * sistema a mano; la primitiva se agregó justamente por este caso.
   */
  return (
    <KgTabsSelect
      ariaLabel="Ventas del alumno"
      value={selectedSaleId}
      onSelect={onSelect}
      options={sales.map((s, i) => {
        const product = products.find((p) => p.id === s.product_id);
        return {
          value: s.id,
          label: `#${i + 1} · ${product?.name ?? "—"} · ${fmtSaleMoney(fxLookup, s, Number(s.total_amount))}`,
        };
      })}
    />
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
      <EmptyState
        title="Sin modalidades de pago"
        hint="Pedile al admin que cargue las modalidades en Comisiones antes de registrar ventas."
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
      <Field label="Producto" htmlFor="sale-product" required>
        <select
          id="sale-product"
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
      <Field label="Modalidad de pago" htmlFor="sale-modality" required>
        <select
          id="sale-modality"
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

      {/* Mobile primero: apilado en 390px, 3 columnas recién en md+. */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[2fr_1fr_1fr]">
        <Field label="Monto pactado" htmlFor="sale-total" required>
          <input
            id="sale-total"
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
        <Field label="Moneda" htmlFor="sale-currency">
          <select
            id="sale-currency"
            name="currency"
            defaultValue="ARS"
            style={controlStyle}
          >
            <option value="ARS">Pesos (ARS)</option>
            <option value="USD">Dólares (USD)</option>
          </select>
        </Field>
        <Field label="Fecha de cierre" htmlFor="sale-closed-at">
          <input
            id="sale-closed-at"
            name="closed_at"
            type="date"
            defaultValue={today}
            onChange={(e) => setClosedAt(e.target.value)}
            style={controlStyle}
          />
        </Field>
      </div>

      <InstallmentPlanFields totalAmount={totalAmount} startDate={closedAt} />

      <div style={subCardStyle}>
        <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
          Atribución
        </div>
        <div
          className="kg-t5"
          style={{ color: "var(--kg-text-1)", marginTop: 4 }}
        >
          {ownerName ?? "Sin asignar"}
        </div>
        <p
          className="kg-t6"
          style={{ color: "var(--kg-text-3)", margin: "6px 0 0" }}
        >
          La venta se imputa al dueño del lead. Para cambiar la atribución,
          editá el setter desde la tarjeta del lead.
        </p>
      </div>

      {state && "error" in state && <ErrorBanner message={state.error} />}

      {/* En 390px los botones se apilan a ancho completo (target de toque). */}
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
          {pending ? "Registrando…" : "Registrar venta"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="kg-focus"
            style={{
              ...secondaryBtn,
              minHeight: 40,
              opacity: pending ? 0.5 : 1,
            }}
          >
            Cancelar
          </button>
        )}
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
  /** Sólo abre/cierra el `KgConfirmDialog` que reemplazó al `confirm()`. */
  const [askDelete, setAskDelete] = useState(false);

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
    <Stack gap={22}>
      {/* Encabezado ficha */}
      <Stack gap={12}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 10,
          }}
        >
          <ClientBadge classification={classification} />
          {overdue.overdueCount > 0 && (
            /*
              El monto vencido NO se pinta de rojo: el estado viaja en el dot
              del StatusPill y el texto queda neutro (regla del DS).
            */
            <StatusPill
              tone={TONE_VAR.negative}
              text={`${overdue.overdueCount} cuota${overdue.overdueCount === 1 ? "" : "s"} vencida${overdue.overdueCount === 1 ? "" : "s"} · ${fmtSaleMoney(fxLookup, sale, overdue.overdueAmount)}`}
            />
          )}
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="kg-focus"
              style={{ ...smallBtn, marginLeft: "auto", minHeight: 36 }}
            >
              Editar venta
            </button>
          )}
        </div>

        {/*
          Los datos de cabecera pasaron de 6 tarjetitas en grilla a un
          `StatRow` (nivel 3 del DS: métricas de apoyo, no tarjetas). El
          Closer sale del StatRow SÓLO cuando es editable — ahí necesita un
          `<select>` y el StatRow no acepta controles.
        */}
        {assignOwnerAction && (
          <CloserAssignField
            currentOwnerId={lead.team_member_id ?? null}
            teamMembers={teamMembers}
            assignOwnerAction={assignOwnerAction}
          />
        )}
        <StatRow
          items={[
            ...(assignOwnerAction
              ? []
              : [{ l: "Closer", v: closerName ?? "Sin asignar" }]),
            { l: "Producto", v: product?.name ?? "—" },
            { l: "Modalidad", v: modality?.name ?? "—" },
            { l: "Fecha de cierre", v: fmtDate(sale.closed_at) },
            {
              l: "Plan",
              v:
                sale.installment_count === 1
                  ? "Pago único"
                  : `${sale.installment_count} · ${frequencyLabel(sale.installment_frequency)}`,
            },
            { l: "% cobrado", v: fmtPercent(collectedPct) },
          ]}
        />

        <div
          className={
            hideCommission
              ? "grid grid-cols-1 gap-3 md:grid-cols-2"
              : "grid grid-cols-1 gap-3 md:grid-cols-3"
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
      </Stack>

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
      <Stack gap={8}>
        <SectionTitle
          actions={
            missingMethod > 0 ? (
              <StatusPill
                tone={TONE_VAR.warning}
                text={`${missingMethod} cobro${missingMethod === 1 ? "" : "s"} sin método`}
              />
            ) : undefined
          }
        >
          Historial de cobros
        </SectionTitle>
        {payments.length === 0 ? (
          <EmptyState
            title="Todavía no se cargó ningún cobro"
            hint="Usá el form de arriba para imputar el primer pago a una cuota."
          />
        ) : (
          <ul style={listStyle}>
            {payments
              .slice()
              .sort((a, b) => a.paid_at.localeCompare(b.paid_at))
              .map((p, i) => (
                <PaymentRowItem
                  key={p.id}
                  payment={p}
                  installments={installments}
                  paymentMethods={paymentMethods}
                  deletePaymentAction={deletePaymentAction}
                  updatePaymentMethodAction={updatePaymentMethodAction}
                  fxLookup={fxLookup}
                  first={i === 0}
                />
              ))}
          </ul>
        )}
      </Stack>

      {deleteSaleAction && (
        <section
          style={{
            ...subCardStyle,
            border: `1px solid ${TONE_VAR.negative}`,
            background: "rgba(220,20,60,0.06)",
          }}
        >
          <h4 className="kg-t7" style={{ margin: 0, color: TONE_VAR.negative }}>
            Borrar venta
          </h4>
          <p
            className="kg-t6"
            style={{ color: "var(--kg-text-3)", margin: "6px 0 12px" }}
          >
            Se borra la venta, sus cuotas y sus {payments.length} cobro
            {payments.length === 1 ? "" : "s"}. El lead queda intacto en la
            columna <b style={{ color: "var(--kg-text-2)" }}>cerrado</b> —
            movelo a otra columna si querés.
          </p>
          <button
            type="button"
            disabled={deletePending}
            onClick={() => setAskDelete(true)}
            className="kg-focus"
            style={{
              ...dangerBtn,
              minHeight: 36,
              opacity: deletePending ? 0.5 : 1,
            }}
          >
            {deletePending ? "Borrando…" : "Borrar venta"}
          </button>

          {/*
            El `confirm()` nativo pasó a `KgConfirmDialog`: mismo texto, misma
            acción y el mismo `useTransition` de antes (se le pasa `pending`
            para que el diálogo no se pueda cerrar a mitad del borrado).
          */}
          <KgConfirmDialog
            open={askDelete}
            onClose={() => setAskDelete(false)}
            title="Borrar venta"
            description={
              payments.length > 0
                ? `¿Borrar la venta de ${fmtSaleMoney(fxLookup, sale, Number(sale.total_amount))} y sus ${payments.length} cobros?`
                : `¿Borrar la venta de ${fmtSaleMoney(fxLookup, sale, Number(sale.total_amount))}?`
            }
            confirmLabel="Borrar venta"
            onConfirm={() => {
              // Cierra al confirmar (como el `confirm()` nativo). El estado
              // "Borrando…" lo sigue mostrando el botón de la sección con su
              // `useTransition` original.
              setAskDelete(false);
              startDeleteTransition(async () => {
                await deleteSaleAction();
                onSaleDeleted();
              });
            }}
          />
        </section>
      )}
    </Stack>
  );
}

// `FieldRow` (la tarjetita label+valor) desapareció: sus 6 usos son ahora un
// solo `StatRow` del DS. Ver el bloque de encabezado de `SalePanel`.

/**
 * Reemplaza la fila estática de "Closer" del StatRow cuando el operador tiene
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
    <div style={{ ...subCardStyle, padding: "8px 14px" }}>
      <label
        htmlFor="sale-closer-assign"
        className="kg-t7"
        style={{ display: "block", color: "var(--kg-text-3)" }}
      >
        Closer
      </label>
      <select
        id="sale-closer-assign"
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
        className="kg-focus"
        style={{ ...bareSelectStyle, opacity: pending ? 0.5 : 1 }}
      >
        <option value="">Sin asignar</option>
        {selectable.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
            {!t.active ? " (inactivo)" : ""}
          </option>
        ))}
      </select>
      {error && (
        <div style={{ marginTop: 6 }}>
          <ErrorBanner message={error} />
        </div>
      )}
    </div>
  );
}

function ClientBadge({
  classification,
}: {
  readonly classification: ClientClassification;
}) {
  // Mismo mapeo de siempre, pero el color va SOLO en el dot del StatusPill
  // (el texto queda neutro — nada de pills tintados en fila).
  const styles: Record<ClientClassification, { label: string; tone: string }> = {
    bueno: { label: "Bueno", tone: TONE_VAR.positive },
    regular: { label: "Regular", tone: TONE_VAR.warning },
    malo: { label: "Malo", tone: TONE_VAR.negative },
  };
  const s = styles[classification];
  return (
    <span title="Clasificación por historial de vencimientos">
      <StatusPill tone={s.tone} text={`Cliente: ${s.label}`} />
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
    <Stack gap={8}>
      <SectionTitle>Cronograma de cuotas</SectionTitle>
      <ol style={listStyle}>
        {statuses.map((st, i) => (
          <InstallmentRowItem
            key={st.installment.id}
            status={st}
            sale={sale}
            fxLookup={fxLookup}
            first={i === 0}
          />
        ))}
      </ol>
    </Stack>
  );
}

function InstallmentRowItem({
  status,
  sale,
  fxLookup,
  first,
}: {
  readonly status: InstallmentStatus;
  readonly sale: SaleRow;
  readonly fxLookup?: FxLookup;
  /** La primera fila no lleva separador (la caja de la lista ya tiene borde). */
  readonly first: boolean;
}) {
  const { installment: inst, paid, remaining, daysOverdue, state } = status;
  const label = statusLabel(state);
  return (
    /* En 390px la fila se parte: datos arriba, monto + estado abajo. */
    <li
      className="flex flex-wrap items-center gap-x-4 gap-y-2"
      style={{
        padding: "10px 14px",
        borderTop: first ? "none" : "1px solid var(--kg-border-subtle)",
        fontSize: 13,
      }}
    >
      <div style={{ minWidth: 140, flex: 1 }}>
        <div className="kg-t5" style={{ color: "var(--kg-text-1)" }}>
          Cuota {inst.number}
        </div>
        <div className="kg-t6" style={{ color: "var(--kg-text-3)" }}>
          Vence {fmtDate(inst.due_date)}
          {state === "overdue" && (
            <> · {daysOverdue} día{daysOverdue === 1 ? "" : "s"} de atraso</>
          )}
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        {/* El monto NO lleva color de estado: eso vive en el pill de al lado. */}
        <div className="kg-num" style={{ fontSize: 12, color: "var(--kg-text-1)" }}>
          {fmtSaleMoney(fxLookup, sale, paid)} /{" "}
          {fmtSaleMoney(fxLookup, sale, Number(inst.amount))}
        </div>
        {remaining > 0 && state !== "paid" && (
          <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
            Saldo {fmtSaleMoney(fxLookup, sale, remaining)}
          </div>
        )}
      </div>
      <StatusPill tone={label.tone} text={label.text} />
    </li>
  );
}

function statusLabel(state: InstallmentStatus["state"]): {
  text: string;
  tone: string | undefined;
} {
  switch (state) {
    case "paid":
      return { text: "Pagada", tone: TONE_VAR.positive };
    case "partial":
      return { text: "Parcial", tone: TONE_VAR.accent };
    case "overdue":
      return { text: "Vencida", tone: TONE_VAR.negative };
    default:
      // Pendiente no tiene tono: `StatusPill` cae al dot neutro.
      return { text: "Pendiente", tone: undefined };
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
    <section
      style={{
        ...subCardStyle,
        border: `1px solid ${TONE_VAR.warning}`,
        background: "rgba(255,184,0,0.06)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <h4 className="kg-t7" style={{ margin: 0, color: TONE_VAR.warning }}>
        Cobros sin cuota asignada ({orphanPayments.length})
      </h4>
      <p className="kg-t6" style={{ margin: 0, color: "var(--kg-text-3)" }}>
        Se regeneró el plan de cuotas y estos cobros quedaron flotando.
        Elegí a qué cuota pertenece cada uno para volver a computarlos en los
        totales por cuota.
      </p>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
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
    <li
      className="flex flex-wrap items-center gap-2"
      style={{ fontSize: 12, color: "var(--kg-text-3)" }}
    >
      <span>
        {fmtDate(payment.paid_at)} ·{" "}
        <span className="kg-num" style={{ color: "var(--kg-text-1)" }}>
          {fmtPaymentMoney(fxLookup, payment)}
        </span>
      </span>
      <select
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
        className="kg-focus"
        style={{ ...controlStyle, maxWidth: 256, opacity: pending ? 0.5 : 1 }}
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
      </select>
      {pending && <span>Guardando…</span>}
      {error && (
        <div style={{ width: "100%" }}>
          <ErrorBanner message={error} />
        </div>
      )}
    </li>
  );
}

/**
 * Tarjeta de monto (Pactado / Cobrado / Comisión).
 *
 * NO usa `SupportKpi` del DS: esa primitiva pide `value: number` + `format`
 * y acá los importes ya vienen formateados por los helpers FX (la moneda
 * depende de si los cobros coinciden con el pactado), no hay slot de `hint`
 * para la fórmula de la comisión, y su número de 27px está calibrado para
 * una página de KPIs, no para el cuerpo de un drawer.
 *
 * El `accent` sólo tiñe el BORDE. El valor va siempre en `--kg-text-1`: la
 * plata no se pinta.
 */
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
      className="kg-glass"
      style={{
        borderRadius: "var(--kg-r-16)",
        border: `1px solid ${accent ? "var(--kg-border-accent)" : "var(--kg-border-subtle)"}`,
        padding: "12px 14px",
      }}
    >
      <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
        {label}
      </div>
      <div
        className="kg-num"
        style={{
          marginTop: 6,
          fontSize: 18,
          fontWeight: 700,
          color: "var(--kg-text-1)",
        }}
      >
        {value}
      </div>
      {hint && (
        <div
          className="kg-t7"
          style={{ marginTop: 4, color: "var(--kg-text-3)", letterSpacing: 0, textTransform: "none" }}
        >
          {hint}
        </div>
      )}
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
      <EmptyState
        title="Sin cuotas generadas"
        hint="Esta venta todavía no tiene plan de cuotas. Editá la venta para regenerarlo."
      />
    );
  }
  if (activeMethods.length === 0) {
    return (
      <EmptyState
        title="Sin métodos de pago activos"
        hint="Pedile al admin que cargue al menos uno en Métodos de pago antes de registrar cobros."
      />
    );
  }

  return (
    <form
      ref={formRef}
      action={handleSubmit}
      style={{
        ...subCardStyle,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <SectionTitle>Cargar cobro</SectionTitle>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Cuota" htmlFor="pay-installment" required>
          <select
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
            style={controlStyle}
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
          </select>
        </Field>
        <Field label="Método de pago" htmlFor="pay-method" required>
          <select
            id="pay-method"
            name="payment_method_id"
            value={selectedMethodId}
            required
            onChange={(e) => {
              const id = e.target.value;
              setSelectedMethodId(id);
              setSelectedCurrency(methodCurrencies[id] ?? "ARS");
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
      </div>
      {/* 5 campos: apilados en 390px, 2 columnas en md y 4 recién en lg. */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Field label="Monto" htmlFor="pay-amount" required>
          <input
            id="pay-amount"
            name="amount"
            type="number"
            step="0.01"
            min="0.01"
            required
            value={amount}
            onChange={(e) => setUserAmount(e.target.value)}
            placeholder="100"
            className="kg-num"
            style={controlStyle}
          />
        </Field>
        <div>
          {/*
            Grupo de 2 botones, no un control único: va con label de grupo en
            vez de `Field` (que necesita un `htmlFor`). El valor viaja al
            FormData por el hidden de siempre, con el mismo `name`.
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
          <input type="hidden" name="original_currency" value={selectedCurrency} />
        </div>
        <Field label="Fecha" htmlFor="pay-date">
          <input
            id="pay-date"
            name="paid_at"
            type="date"
            defaultValue={todayInAR()}
            style={controlStyle}
          />
        </Field>
        <Field label="Nº de transacción" htmlFor="pay-transaction">
          <input
            id="pay-transaction"
            name="transaction_number"
            placeholder="Opcional (comprobante del banco)"
            style={controlStyle}
          />
        </Field>
        <Field label="Notas" htmlFor="pay-notes">
          <input
            id="pay-notes"
            name="notes"
            placeholder="Opcional"
            style={controlStyle}
          />
        </Field>
      </div>
      <input
        type="hidden"
        name="invoice_id"
        value={matchedInvoice?.id ?? ""}
      />
      {installmentId ? (
        <div className="kg-t6" style={{ color: "var(--kg-text-3)" }}>
          {matchedInvoice ? (
            <>
              Se aplicará a la factura{" "}
              <b style={{ color: "var(--kg-text-1)" }}>
                {matchedInvoice.invoice_number ?? "—"}
              </b>{" "}
              (emitida por esta cuota).
            </>
          ) : (
            <>Sin factura emitida para esta cuota — el cobro queda sin factura vinculada.</>
          )}
        </div>
      ) : null}
      {error && <ErrorBanner message={error} />}
      <div>
        <button
          type="submit"
          disabled={pending}
          className="kg-focus w-full md:w-auto"
          style={{
            ...primaryBtn,
            minHeight: 40,
            opacity: pending ? 0.7 : 1,
            cursor: pending ? "not-allowed" : "pointer",
          }}
        >
          {pending ? "Cargando…" : "+ Agregar cobro"}
        </button>
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
  first,
}: {
  readonly payment: PaymentRow;
  readonly installments: ReadonlyArray<InstallmentRow>;
  readonly paymentMethods: ReadonlyArray<PaymentMethodRow>;
  readonly deletePaymentAction: DeletePaymentAction;
  readonly updatePaymentMethodAction?: UpdatePaymentMethodAction;
  readonly fxLookup?: FxLookup;
  /** La primera fila no lleva separador (la caja de la lista ya tiene borde). */
  readonly first: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [methodPending, startMethodTransition] = useTransition();
  const [methodError, setMethodError] = useState<string | null>(null);
  /** Sólo abre/cierra el `KgConfirmDialog` que reemplazó al `confirm()`. */
  const [askDelete, setAskDelete] = useState(false);

  const inst = installments.find((i) => i.id === payment.installment_id) ?? null;
  const method = paymentMethods.find((m) => m.id === payment.payment_method_id) ?? null;
  const activeMethods = paymentMethods.filter(
    (m) => m.active || m.id === payment.payment_method_id,
  );

  return (
    <li
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
        padding: "12px 14px",
        borderTop: first ? "none" : "1px solid var(--kg-border-subtle)",
      }}
    >
      <div
        style={{
          minWidth: 0,
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span
            className="kg-num"
            style={{ fontSize: 13, fontWeight: 600, color: "var(--kg-text-1)" }}
          >
            {fmtPaymentMoney(fxLookup, payment)}
          </span>
          <span className="kg-t6" style={{ color: "var(--kg-text-3)" }}>
            {fmtDate(payment.paid_at)}
          </span>
        </div>
        <div
          className="flex flex-wrap items-center gap-2"
          style={{ fontSize: 12, color: "var(--kg-text-3)" }}
        >
          <span>
            {inst ? (
              `Cuota ${inst.number}`
            ) : (
              <StatusPill tone={TONE_VAR.warning} text="Sin cuota" />
            )}
          </span>
          <span>·</span>
          {updatePaymentMethodAction ? (
            <select
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
              className="kg-focus"
              style={{
                ...controlStyle,
                maxWidth: 192,
                fontSize: 12,
                opacity: methodPending ? 0.5 : 1,
              }}
            >
              <option value="">— Sin método —</option>
              {activeMethods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {!m.active ? " (inactivo)" : ""}
                </option>
              ))}
            </select>
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
        {methodError && <ErrorBanner message={methodError} />}
      </div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => setAskDelete(true)}
        aria-label={`Borrar cobro de ${fmtPaymentMoney(fxLookup, payment)}`}
        title="Borrar cobro"
        className="kg-focus"
        style={{
          ...dangerBtn,
          minHeight: 36,
          minWidth: 36,
          padding: 0,
          flexShrink: 0,
          opacity: isPending ? 0.5 : 1,
        }}
      >
        ×
      </button>

      {/* Mismo texto que el `confirm()` nativo que había acá. */}
      <KgConfirmDialog
        open={askDelete}
        onClose={() => setAskDelete(false)}
        title="Borrar cobro"
        description={`¿Borrar cobro de ${fmtPaymentMoney(fxLookup, payment)}?`}
        confirmLabel="Borrar cobro"
        onConfirm={() => {
          // Se cierra al confirmar, igual que el `confirm()` nativo: el
          // feedback de "Borrando…" ya lo da el botón de la fila con su
          // `useTransition` (que no se tocó).
          setAskDelete(false);
          startTransition(async () => {
            await deletePaymentAction(payment.id);
          });
        }}
      />
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
      <section style={{ ...subCardStyle, padding: "8px 14px" }}>
        <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
          Producto
        </div>
        <div
          className="kg-t5"
          style={{ color: "var(--kg-text-1)", marginTop: 4 }}
        >
          {currentProductName}
        </div>
      </section>
    );
  }

  return (
    <section style={{ ...subCardStyle, padding: "8px 14px" }}>
      <label
        htmlFor="sale-product-assign"
        className="kg-t7"
        style={{ display: "block", color: "var(--kg-text-3)" }}
      >
        Producto
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <select
          id="sale-product-assign"
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
          className="kg-focus"
          style={{ ...bareSelectStyle, opacity: pending ? 0.5 : 1 }}
        >
          {activeProducts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {!p.active ? " (inactivo)" : ""}
            </option>
          ))}
        </select>
        {pending && (
          <span className="kg-t6" style={{ color: "var(--kg-text-3)" }}>
            Guardando…
          </span>
        )}
      </div>
      {error && (
        <div style={{ marginBottom: 8 }}>
          <ErrorBanner message={error} />
        </div>
      )}
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
    <section
      className="flex flex-wrap items-center gap-2"
      style={{ ...subCardStyle, padding: "10px 14px" }}
    >
      {hasSnapshot ? (
        <StatusPill tone={TONE_VAR.positive} text="Comisión congelada al cierre" />
      ) : (
        <StatusPill
          tone={TONE_VAR.warning}
          text="Sin regla congelada (usando la vigente)"
        />
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
            className="kg-focus"
            style={{
              ...smallBtn,
              minHeight: 36,
              marginLeft: "auto",
              opacity: pending ? 0.5 : 1,
            }}
          >
            {pending ? "Recalculando…" : "Recalcular con regla actual"}
          </button>
          {justRecalculated && (
            <StatusPill tone={TONE_VAR.positive} text="Actualizada." />
          )}
          {error && (
            <div style={{ width: "100%" }}>
              <ErrorBanner message={error} />
            </div>
          )}
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
    <form
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <Field label="Producto" htmlFor="edit-product" required>
        <select
          id="edit-product"
          name="product_id"
          required
          defaultValue={sale.product_id}
          style={controlStyle}
        >
          {visibleProducts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {!p.active ? " (inactivo)" : ""}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Modalidad de pago" htmlFor="edit-modality" required>
        <select
          id="edit-modality"
          name="payment_modality_id"
          required
          defaultValue={sale.payment_modality_id}
          style={controlStyle}
        >
          {visibleModalities.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {!m.active ? " (inactiva)" : ""}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[2fr_1fr_1fr]">
        <Field label="Monto pactado" htmlFor="edit-total" required>
          <input
            id="edit-total"
            name="total_amount"
            type="number"
            step="0.01"
            min="0"
            required
            value={String(totalAmount)}
            onChange={(e) => setTotalAmount(parseFloat(e.target.value) || 0)}
            className="kg-num"
            style={controlStyle}
          />
        </Field>
        <Field label="Moneda" htmlFor="edit-currency">
          <select
            id="edit-currency"
            name="currency"
            defaultValue={sale.currency ?? "ARS"}
            style={controlStyle}
          >
            <option value="ARS">Pesos (ARS)</option>
            <option value="USD">Dólares (USD)</option>
          </select>
        </Field>
        <Field label="Fecha de cierre" htmlFor="edit-closed-at">
          <input
            id="edit-closed-at"
            name="closed_at"
            type="date"
            value={closedAt}
            onChange={(e) => setClosedAt(e.target.value)}
            style={controlStyle}
          />
        </Field>
      </div>

      <InstallmentPlanFields
        totalAmount={totalAmount}
        startDate={closedAt}
        defaultCount={sale.installment_count}
        defaultFrequency={sale.installment_frequency}
        defaultGraceDays={sale.grace_days}
      />

      {/*
        Aviso, no error: nada falló todavía. Es exactamente el caso del tono
        `warning` de `ErrorBanner` (role="status", no interrumpe al lector).
      */}
      <ErrorBanner
        tone="warning"
        message="Aviso: si cambiás la cantidad de cuotas, la frecuencia, el monto o la fecha de cierre, se regenera el plan y todos los cobros ya cargados quedan flotando. Los podés re-asignar cuota por cuota desde la ficha."
      />

      {!hideCommission && (
        <label
          htmlFor="edit-regenerate"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            minHeight: 36,
            fontSize: 12,
            color: "var(--kg-text-2)",
            cursor: "pointer",
          }}
        >
          <input
            id="edit-regenerate"
            type="checkbox"
            name="regenerate"
            style={{
              marginTop: 2,
              cursor: "pointer",
              accentColor: "var(--kg-accent-500)",
            }}
          />
          <span>
            Recalcular comisión con la regla actual.
            <span style={{ marginLeft: 4, color: "var(--kg-text-3)" }}>
              Por default el snapshot queda como estaba al cierre (Fase 7).
            </span>
          </span>
        </label>
      )}

      {state && "error" in state && <ErrorBanner message={state.error} />}

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
          {pending ? "Guardando…" : "Guardar cambios"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="kg-focus"
          style={{
            ...secondaryBtn,
            minHeight: 40,
            opacity: pending ? 0.5 : 1,
          }}
        >
          Cancelar
        </button>
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
    <Stack gap={16}>
      {/*
        Resumen de la venta con `StatRow` (nivel 3 del DS). El aviso de
        moneda mixta sale del renglón del monto y pasa a un `StatusPill`
        aparte: el estado no se pinta encima de la plata.
      */}
      <Stack gap={8}>
        <StatRow
          items={[
            {
              l: "Pactado",
              v: fmtSaleMoney(fxLookup, sale, Number(sale.total_amount)),
            },
            { l: "Cobrado", v: fmtCollected(collectedDisplay, fxLookup) },
            {
              l: collectedDisplay.mixed && balanceUsd !== null
                ? "Saldo (USD)"
                : "Saldo",
              v:
                balanceNative !== null
                  ? fmtSaleMoney(fxLookup, sale, balanceNative)
                  : balanceUsd !== null
                    ? fmtUsd(balanceUsd)
                    : "—",
            },
          ]}
        />
        {collectedDisplay.mixed && (
          <span title="Cobros en moneda distinta al pactado. Total mostrado convertido a USD.">
            <StatusPill tone={TONE_VAR.warning} text="Moneda distinta al pactado" />
          </span>
        )}
      </Stack>
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
    </Stack>
  );
}
