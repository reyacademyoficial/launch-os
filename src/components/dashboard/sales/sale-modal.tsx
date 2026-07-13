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
type AddPaymentAction = (
  prev: PaymentActionState,
  formData: FormData,
) => Promise<PaymentActionState>;
type DeleteAction = (id: string) => Promise<void>;
type UpdateProductAction = (
  productId: string,
) => Promise<{ ok: true } | { error: string }>;

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
  sale,
  saleRank,
  payments,
  modalities,
  products,
  rules,
  teamMembers,
  createSaleAction,
  updateProductAction,
  addPaymentAction,
  deletePaymentAction,
  deleteSaleAction,
}: {
  readonly triggerLabel: string;
  readonly triggerClassName?: string;
  readonly lead: Pick<LeadRow, "id" | "name" | "launch_id" | "team_member_id">;
  readonly sale: SaleRow | null;
  /**
   * Posición 0-based de la venta dentro de (team_member, launch). Lo calcula
   * el contenedor (kanban) con `buildSaleRanks`. Para venta nueva pasar 0.
   */
  readonly saleRank: number;
  readonly payments: ReadonlyArray<PaymentRow>;
  readonly modalities: ReadonlyArray<PaymentModalityRow>;
  readonly products: ReadonlyArray<ProductRow>;
  readonly rules: ReadonlyArray<CommissionRuleRow>;
  readonly teamMembers: ReadonlyArray<Pick<TeamMemberRow, "id" | "name" | "active">>;
  readonly createSaleAction: SaleAction;
  /**
   * Cambia el producto asignado a la venta sin tocar el resto (modalidad,
   * cobros, comisión). Bindeada al saleId. Si no se pasa, el panel muestra
   * el producto como sólo lectura — útil para roles sin permiso de edición.
   */
  readonly updateProductAction?: UpdateProductAction;
  readonly addPaymentAction: AddPaymentAction;
  readonly deletePaymentAction: DeleteAction;
  /**
   * Borra la sale (los payments caen por CASCADE). El lead NO se borra. Si
   * no se pasa, no se muestra el botón. Lo deja opcional así callers viejos
   * no rompen.
   */
  readonly deleteSaleAction?: DeleteAction;
}) {
  const [open, setOpen] = useState(false);

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
                <h3 className="text-lg font-bold text-fg">
                  {sale ? "Venta cerrada" : "Registrar venta"}
                </h3>
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

            <div className="flex-1 overflow-y-auto px-6 py-6">
              {sale ? (
                <SalePanel
                  sale={sale}
                  saleRank={saleRank}
                  payments={payments}
                  modalities={modalities}
                  products={products}
                  rules={rules}
                  launchId={lead.launch_id}
                  updateProductAction={updateProductAction}
                  addPaymentAction={addPaymentAction}
                  deletePaymentAction={deletePaymentAction}
                  deleteSaleAction={deleteSaleAction}
                  onSaleDeleted={() => setOpen(false)}
                />
              ) : (
                <NewSaleForm
                  lead={lead}
                  modalities={modalities}
                  products={products}
                  teamMembers={teamMembers}
                  createSaleAction={createSaleAction}
                  onSuccess={() => setOpen(false)}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
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
}: {
  readonly lead: Pick<LeadRow, "id" | "team_member_id">;
  readonly modalities: ReadonlyArray<PaymentModalityRow>;
  readonly products: ReadonlyArray<ProductRow>;
  readonly teamMembers: ReadonlyArray<Pick<TeamMemberRow, "id" | "name" | "active">>;
  readonly createSaleAction: SaleAction;
  readonly onSuccess: () => void;
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
  updateProductAction,
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
  readonly updateProductAction?: UpdateProductAction;
  readonly addPaymentAction: AddPaymentAction;
  readonly deletePaymentAction: DeleteAction;
  readonly deleteSaleAction?: DeleteAction;
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

      <section className="text-xs text-fg-subtle">
        Modalidad: <span className="text-fg-muted">{modality?.name ?? "—"}</span>
        <span className="mx-2">·</span>
        Cierre: <span className="text-fg-muted">{sale.closed_at.slice(0, 10)}</span>
        {!rule && (
          <span className="ml-2 rounded-full bg-warning/15 px-2 py-0.5 text-warning">
            Sin regla configurada → comisión = 0
          </span>
        )}
      </section>

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
                await deleteSaleAction(sale.id);
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
  readonly addPaymentAction: AddPaymentAction;
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
  readonly deletePaymentAction: DeleteAction;
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
  readonly updateProductAction?: UpdateProductAction;
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
