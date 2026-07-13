"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";

import type {
  PaymentActionState,
  SaleActionState,
} from "@/app/(app)/proyectos/[projectId]/leads/sale-actions";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { computeCommission, findApplicableRule } from "@/lib/commissions/calc";
import type {
  CommissionRuleRow,
  PaymentModalityRow,
  PaymentRow,
  SaleRow,
} from "@/lib/commissions/types";
import { fmtMoney } from "@/lib/format";
import type { LeadRow } from "@/lib/leads/types";
import type { ProductRow } from "@/lib/products/types";
import type { TeamMemberRow } from "@/lib/team/types";

type SaleAction = (
  prev: SaleActionState,
  formData: FormData,
) => Promise<SaleActionState>;
// Fase 8: la firma de las actions ligadas a un saleId ahora acepta el saleId
// como primer parámetro. El modal lo bindea internamente para poder rotar
// entre varias sales del mismo lead sin que el caller tenga que armar N
// callbacks bindeadas.
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

// Variantes ya bindeadas al saleId, para consumo del SalePanel.
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
 * Modal único que sirve a dos escenarios:
 *   - Lead sin sale: form "Registrar venta". Al guardar, el lead pasa
 *     automáticamente a status='cerrado' (lo hace la server action).
 *   - Lead con sale: ficha de la venta + tabla de cobros + form para agregar
 *     cobro + comisión calculada en vivo (recálculo derivado en cada render).
 */
export function SaleModal({
  triggerLabel,
  triggerClassName,
  lead,
  sales,
  saleRanks,
  paymentsBySaleId,
  modalities,
  products,
  rules,
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
}: {
  readonly triggerLabel: string;
  readonly triggerClassName?: string;
  readonly lead: Pick<LeadRow, "id" | "name" | "launch_id" | "team_member_id">;
  /**
   * Todas las ventas del lead (Fase 8: puede haber N). Si el array está
   * vacío el modal arranca en modo "Registrar venta". Si tiene ≥1, el
   * usuario elige cuál ver con el selector (visible solo si N>1).
   */
  readonly sales: ReadonlyArray<SaleRow>;
  /** Rank por sale.id para el cálculo de comisión (buildSaleRanks). */
  readonly saleRanks: ReadonlyMap<string, number>;
  /** Payments indexados por sale_id. */
  readonly paymentsBySaleId: ReadonlyMap<string, ReadonlyArray<PaymentRow>>;
  readonly modalities: ReadonlyArray<PaymentModalityRow>;
  readonly products: ReadonlyArray<ProductRow>;
  readonly rules: ReadonlyArray<CommissionRuleRow>;
  readonly teamMembers: ReadonlyArray<Pick<TeamMemberRow, "id" | "name" | "active">>;
  /**
   * Sale a preseleccionar al abrir. Útil desde CobrosView (una fila = una
   * sale). Si no se pasa, arranca en la primera del array.
   */
  readonly initialSaleId?: string;
  /**
   * ¿Mostrar el botón "+ Nueva venta" para agregar otra sale al mismo lead?
   * Default: true (kanban). En CobrosView lo mandamos false porque cada
   * fila es un contexto de una sola sale.
   */
  readonly allowCreateAnother?: boolean;
  readonly createSaleAction: SaleAction;
  /**
   * Bindeada al projectId. Adentro se rebindea al saleId de la venta que se
   * está editando. Si no viene, el botón "Editar venta" no aparece.
   */
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
}) {
  const [open, setOpen] = useState(false);
  // "list": mostramos el SalePanel de la sale seleccionada.
  // "new": form para crear una venta (nueva o primera).
  // "edit": form para modificar la sale seleccionada.
  const [mode, setMode] = useState<"list" | "new" | "edit">("list");
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);

  // Cuando se abre el modal, elegimos qué sale mostrar y reseteamos el mode.
  useEffect(() => {
    if (!open) return;
    setMode(sales.length === 0 ? "new" : "list");
    if (sales.length === 0) {
      setSelectedSaleId(null);
      return;
    }
    // Preferimos initialSaleId si vale (existe en el array).
    if (initialSaleId && sales.some((s) => s.id === initialSaleId)) {
      setSelectedSaleId(initialSaleId);
    } else {
      setSelectedSaleId(sales[0]!.id);
    }
  }, [open, sales, initialSaleId]);

  const selectedSale =
    (mode === "list" || mode === "edit") && selectedSaleId
      ? sales.find((s) => s.id === selectedSaleId) ?? null
      : null;

  const headerTitle =
    mode === "new"
      ? sales.length > 0
        ? "Nueva venta para este lead"
        : "Registrar venta"
      : mode === "edit"
        ? "Editar venta"
        : sales.length > 1
        ? `Ventas (${sales.length})`
        : "Venta cerrada";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
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
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-md border border-border bg-bg-elevated shadow-card">
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

            {/* Selector de sale + botón "+ Nueva" — solo en modo list y si
                tenemos al menos 1 sale (o el flag permite crear otra). */}
            {mode === "list" && sales.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface/40 px-6 py-3">
                {sales.length > 1 && (
                  <SaleTabs
                    sales={sales}
                    products={products}
                    selectedSaleId={selectedSaleId}
                    onSelect={setSelectedSaleId}
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
              {mode === "new" ? (
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
                />
              ) : selectedSale ? (
                <SalePanel
                  sale={selectedSale}
                  saleRank={saleRanks.get(selectedSale.id) ?? 0}
                  payments={paymentsBySaleId.get(selectedSale.id) ?? []}
                  modalities={modalities}
                  products={products}
                  rules={rules}
                  launchId={selectedSale.launch_id}
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
                  onSaleDeleted={() => {
                    if (sales.length > 1) {
                      // Quedan más sales — nos quedamos en modo list y el
                      // useEffect al re-render elige otra.
                      setSelectedSaleId(null);
                    } else {
                      setOpen(false);
                    }
                  }}
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

/**
 * Tabs horizontales con las N ventas del lead. Muestra producto + monto
 * pactado para que el operador identifique cuál abrir.
 */
function SaleTabs({
  sales,
  products,
  selectedSaleId,
  onSelect,
}: {
  readonly sales: ReadonlyArray<SaleRow>;
  readonly products: ReadonlyArray<ProductRow>;
  readonly selectedSaleId: string | null;
  readonly onSelect: (saleId: string) => void;
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
            #{i + 1} · {product?.name ?? "—"} · {fmtMoney(s.total_amount)}
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
  /** Volver al listado sin crear (multi-venta). Si no se pasa, no se muestra. */
  readonly onCancel?: () => void;
}) {
  const [state, formAction, pending] = useActionState<SaleActionState, FormData>(
    createSaleAction,
    null,
  );

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
        <Select
          id="sale-product"
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
          />
          <p className="mt-1 text-xs text-fg-subtle">
            Es referencia. La comisión se calcula sobre lo que efectivamente
            se cobre.
          </p>
        </div>
        <div>
          <Label htmlFor="sale-closed-at">Fecha de cierre</Label>
          <Input
            id="sale-closed-at"
            name="closed_at"
            type="date"
            defaultValue={new Date().toISOString().slice(0, 10)}
          />
        </div>
      </div>

      <div className="rounded-md border border-border bg-surface/40 px-3 py-2 text-xs">
        <div className="uppercase tracking-wide text-fg-subtle">
          Atribución
        </div>
        <div className="mt-1 text-fg">
          {ownerName ?? "Sin asignar"}
        </div>
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

// ─── Panel de venta + cobros ───────────────────────────────────────────────

function SalePanel({
  sale,
  saleRank,
  payments,
  modalities,
  products,
  rules,
  launchId,
  onEdit,
  updateProductAction,
  recalculateAction,
  addPaymentAction,
  deletePaymentAction,
  deleteSaleAction,
  onSaleDeleted,
}: {
  readonly sale: SaleRow;
  readonly saleRank: number;
  readonly payments: ReadonlyArray<PaymentRow>;
  readonly modalities: ReadonlyArray<PaymentModalityRow>;
  readonly products: ReadonlyArray<ProductRow>;
  readonly rules: ReadonlyArray<CommissionRuleRow>;
  readonly launchId: string | null;
  /**
   * Switch al modo edit del modal. Botón "Editar venta" solo aparece si viene.
   */
  readonly onEdit?: () => void;
  readonly updateProductAction?: BoundUpdateProduct;
  readonly recalculateAction?: BoundRecalculate;
  readonly addPaymentAction: BoundAddPayment;
  readonly deletePaymentAction: DeletePaymentAction;
  readonly deleteSaleAction?: BoundDeleteSale;
  readonly onSaleDeleted: () => void;
}) {
  const modality = modalities.find((m) => m.id === sale.payment_modality_id);
  const product = products.find((p) => p.id === sale.product_id);
  const rule = findApplicableRule(rules, sale.payment_modality_id, launchId);
  const breakdown = computeCommission(sale, payments, rule, saleRank);
  const [deletePending, startDeleteTransition] = useTransition();

  return (
    <div className="space-y-6">
      {/* Resumen de la venta */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card label="Pactado" value={fmtMoney(sale.total_amount)} />
        <Card
          label="Cobrado"
          value={fmtMoney(breakdown.collected)}
          hint={`${payments.length} cobro${payments.length === 1 ? "" : "s"}`}
        />
        <Card
          label="Comisión actual"
          value={fmtMoney(breakdown.commission)}
          hint={breakdown.formula}
          accent
        />
      </section>

      <section className="flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
        <span>
          Modalidad:{" "}
          <span className="text-fg-muted">{modality?.name ?? "—"}</span>
        </span>
        <span>·</span>
        <span>
          Cierre:{" "}
          <span className="text-fg-muted">{sale.closed_at.slice(0, 10)}</span>
        </span>
        {!sale.commission_rule_snapshot && !rule && (
          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-warning">
            Sin regla configurada → comisión = 0
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
      </section>

      <CommissionSnapshotBar
        hasSnapshot={sale.commission_rule_snapshot !== null}
        recalculateAction={recalculateAction}
      />

      <ProductAssign
        currentProductId={sale.product_id}
        currentProductName={product?.name ?? "—"}
        products={products}
        updateProductAction={updateProductAction}
      />

      {/* Form cargar cobro */}
      <PaymentForm addPaymentAction={addPaymentAction} />

      {/* Lista de cobros */}
      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
          Historial de cobros
        </h4>
        {payments.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-surface/40 p-4 text-sm text-fg-muted">
            Todavía no se cargó ningún cobro.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {payments.map((p) => (
              <PaymentRow
                key={p.id}
                payment={p}
                deletePaymentAction={deletePaymentAction}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Zona de peligro: borrar la venta. No toca el lead. */}
      {deleteSaleAction && (
        <section className="rounded-md border border-error/30 bg-error/5 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-error">
            Borrar venta
          </h4>
          <p className="mt-1 text-xs text-fg-muted">
            Se borra la venta y sus {payments.length} cobro
            {payments.length === 1 ? "" : "s"}. El lead queda intacto en la
            columna <b>cerrado</b> — movelo a otra columna si querés.
          </p>
          <button
            type="button"
            disabled={deletePending}
            onClick={() => {
              const msg =
                payments.length > 0
                  ? `¿Borrar la venta de ${fmtMoney(sale.total_amount)} y sus ${payments.length} cobros?`
                  : `¿Borrar la venta de ${fmtMoney(sale.total_amount)}?`;
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
  addPaymentAction,
}: {
  readonly addPaymentAction: BoundAddPayment;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement | null>(null);

  // Llamamos a la action a mano para poder resetear el form en éxito sin usar
  // setState dentro de useEffect (anti-pattern flagged por
  // react-hooks/set-state-in-effect).
  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await addPaymentAction(null, formData);
      if (result && "error" in result) {
        setError(result.error);
        return;
      }
      formRef.current?.reset();
    });
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="pay-amount">Monto *</Label>
          <Input
            id="pay-amount"
            name="amount"
            type="number"
            step="0.01"
            min="0.01"
            required
            placeholder="100"
          />
        </div>
        <div>
          <Label htmlFor="pay-date">Fecha</Label>
          <Input
            id="pay-date"
            name="paid_at"
            type="date"
            defaultValue={new Date().toISOString().slice(0, 10)}
          />
        </div>
        <div>
          <Label htmlFor="pay-notes">Notas</Label>
          <Input id="pay-notes" name="notes" placeholder="Opcional" />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Cargando…" : "+ Agregar cobro"}
        </Button>
        {error && <FieldError>{error}</FieldError>}
      </div>
    </form>
  );
}

function PaymentRow({
  payment,
  deletePaymentAction,
}: {
  readonly payment: PaymentRow;
  readonly deletePaymentAction: DeletePaymentAction;
}) {
  const [isPending, startTransition] = useTransition();
  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <div className="font-medium tabular-nums text-fg">
          {fmtMoney(payment.amount)}
        </div>
        <div className="mt-0.5 text-xs text-fg-subtle">
          {payment.paid_at}
          {payment.notes && (
            <>
              <span className="mx-2">·</span>
              <span className="text-fg-muted">{payment.notes}</span>
            </>
          )}
        </div>
      </div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!confirm(`¿Borrar cobro de ${fmtMoney(payment.amount)}?`)) return;
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

/**
 * Bloque para ver/cambiar el producto asignado a la venta. Si el caller no
 * pasa `updateProductAction`, se muestra sólo el nombre (read-only). Con la
 * action disponible, el operador puede reasignar en 1 click desde el mismo
 * modal — flujo pensado para cobros/ventas que quedaron en "Sin categoría"
 * tras el backfill de la migración 0038.
 */
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

/**
 * Barra de estado de la comisión. Muestra si la venta tiene una regla
 * congelada (snapshot) y ofrece el botón para recalcular contra la regla
 * vigente — pensado para cuando el admin actualizó las reglas y esta venta
 * concreta necesita seguir la nueva política.
 */
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

/**
 * Form para editar una venta existente. Reusa la misma shape que
 * NewSaleForm (producto + modalidad + monto + fecha) pero prefill con los
 * valores actuales y con checkbox opcional "Recalcular comisión con la
 * regla actual".
 *
 * NO permite cambiar `launch_id` — política Fase 8: si la venta pertenece
 * a otro launch, se crea una nueva y se borra ésta. Editar el launch de
 * una venta con cobros abre puertas raras (payments quedarían en el launch
 * viejo pero atribuidos al nuevo).
 */
function EditSaleForm({
  sale,
  modalities,
  products,
  updateSaleAction,
  onCancel,
  onSuccess,
}: {
  readonly sale: SaleRow;
  readonly modalities: ReadonlyArray<PaymentModalityRow>;
  readonly products: ReadonlyArray<ProductRow>;
  readonly updateSaleAction: SaleAction;
  readonly onCancel: () => void;
  readonly onSuccess: () => void;
}) {
  const [state, formAction, pending] = useActionState<SaleActionState, FormData>(
    updateSaleAction,
    null,
  );

  useEffect(() => {
    if (state && "ok" in state && state.ok) onSuccess();
  }, [state, onSuccess]);

  // Incluimos productos y modalidades inactivos si son los actuales de la
  // venta, así el operador puede ver el valor cargado sin desaparecer.
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="edit-total">Monto pactado *</Label>
          <Input
            id="edit-total"
            name="total_amount"
            type="number"
            step="0.01"
            min="0"
            required
            defaultValue={String(sale.total_amount)}
          />
        </div>
        <div>
          <Label htmlFor="edit-closed-at">Fecha de cierre</Label>
          <Input
            id="edit-closed-at"
            name="closed_at"
            type="date"
            defaultValue={sale.closed_at.slice(0, 10)}
          />
        </div>
      </div>

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
            Marcá esto si estás corrigiendo un error de carga y querés que la
            comisión refleje la combinación nueva.
          </span>
        </span>
      </label>

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
