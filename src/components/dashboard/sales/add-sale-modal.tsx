"use client";

import { useActionState, useEffect, useState } from "react";

import type { SaleActionState } from "@/app/(app)/proyectos/[projectId]/leads/sale-actions";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { PaymentModalityRow } from "@/lib/commissions/types";
import { todayInAR } from "@/lib/installments/status";
import type { ProductRow } from "@/lib/products/types";
import type { TeamMemberRow } from "@/lib/team/types";

import { InstallmentPlanFields } from "./installment-plan-fields";

type CreateSaleWithLeadAction = (
  prev: SaleActionState,
  formData: FormData,
) => Promise<SaleActionState>;

/**
 * Botón "+ Agregar venta" para la vista project-wide de Ventas. Abre un modal
 * que crea lead + venta en un solo submit. Soporta cargar N ventas seguidas:
 * el checkbox "Cargar otra al guardar" mantiene el modal abierto y resetea el
 * form tras cada éxito (vía bump de `formKey`).
 */
export function AddSaleModal({
  launches,
  modalities,
  products,
  teamMembers,
  createSaleWithLeadAction,
}: {
  readonly launches: ReadonlyArray<{ id: string; name: string }>;
  readonly modalities: ReadonlyArray<PaymentModalityRow>;
  readonly products: ReadonlyArray<ProductRow>;
  readonly teamMembers: ReadonlyArray<
    Pick<TeamMemberRow, "id" | "name" | "active">
  >;
  readonly createSaleWithLeadAction: CreateSaleWithLeadAction;
}) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [keepOpen, setKeepOpen] = useState(false);
  const [savedCount, setSavedCount] = useState(0);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setSavedCount(0);
          setKeepOpen(false);
          setFormKey((k) => k + 1);
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
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-md border border-border bg-bg-elevated shadow-card">
            <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
              <div>
                <h3 className="text-lg font-bold text-fg">Cargar venta</h3>
                <p className="mt-0.5 text-xs text-fg-subtle">
                  {savedCount === 0
                    ? "Se crea el alumno y la venta en un solo paso."
                    : `${savedCount} venta${savedCount === 1 ? "" : "s"} cargada${savedCount === 1 ? "" : "s"} en esta sesión.`}
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
              <AddSaleForm
                key={formKey}
                launches={launches}
                modalities={modalities}
                products={products}
                teamMembers={teamMembers}
                createSaleWithLeadAction={createSaleWithLeadAction}
                keepOpen={keepOpen}
                setKeepOpen={setKeepOpen}
                onSuccess={() => {
                  setSavedCount((n) => n + 1);
                  if (keepOpen) {
                    setFormKey((k) => k + 1);
                  } else {
                    setOpen(false);
                  }
                }}
              />
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
  readonly onSuccess: () => void;
}) {
  const [state, formAction, pending] = useActionState<
    SaleActionState,
    FormData
  >(createSaleWithLeadAction, null);

  const today = todayInAR();
  const [totalAmount, setTotalAmount] = useState<number>(0);
  const [closedAt, setClosedAt] = useState<string>(today);

  useEffect(() => {
    if (state && "ok" in state && state.ok) onSuccess();
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
          <Label htmlFor="add-sale-lead-contact">Contacto</Label>
          <Input
            id="add-sale-lead-contact"
            name="lead_contact"
            placeholder="Email o teléfono"
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
          {pending ? "Registrando…" : "Registrar venta"}
        </Button>
        <label className="flex items-center gap-2 text-xs text-fg-muted">
          <input
            type="checkbox"
            checked={keepOpen}
            onChange={(e) => setKeepOpen(e.target.checked)}
          />
          Cargar otra venta al guardar
        </label>
        {state && "error" in state && <FieldError>{state.error}</FieldError>}
      </div>
    </form>
  );
}
