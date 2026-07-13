"use client";

import { useActionState, useEffect, useState } from "react";

import type { CommissionActionState } from "@/app/(app)/proyectos/[projectId]/comisiones/actions";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type {
  AccrualMode,
  CommissionTierType,
  PaymentModalityRow,
  ThresholdType,
} from "@/lib/commissions/types";
import type { ProductRow } from "@/lib/products/types";

type FormAction = (
  prev: CommissionActionState,
  formData: FormData,
) => Promise<CommissionActionState>;

interface TierDraft {
  min_count: number;
  max_count: number | null;
  type: CommissionTierType;
  value: number;
}

const DEFAULT_TIER: TierDraft = {
  min_count: 0,
  max_count: null,
  type: "percent",
  value: 10,
};

export interface RuleInitial {
  modality_ids: ReadonlyArray<string>;
  launch_id: string | null;
  product_id: string | null;
  accrual_mode: AccrualMode;
  threshold_type: ThresholdType | null;
  threshold_value: number | null;
  tiers: ReadonlyArray<{
    min_count: number;
    max_count: number | null;
    type: CommissionTierType;
    value: number;
  }>;
}

type RuleScope = "default" | "launch" | "product";

function initialScope(initial: RuleInitial | undefined): RuleScope {
  if (!initial) return "default";
  if (initial.launch_id) return "launch";
  if (initial.product_id) return "product";
  return "default";
}

export function RuleForm({
  action,
  modalities,
  launches,
  products,
  submitLabel,
  onSuccess,
  initial,
}: {
  readonly action: FormAction;
  readonly modalities: ReadonlyArray<PaymentModalityRow>;
  readonly launches: ReadonlyArray<{ id: string; name: string }>;
  readonly products: ReadonlyArray<ProductRow>;
  readonly submitLabel: string;
  readonly onSuccess?: () => void;
  readonly initial?: RuleInitial;
}) {
  const [state, formAction, pending] = useActionState<CommissionActionState, FormData>(
    action,
    null,
  );

  const [scope, setScope] = useState<RuleScope>(() => initialScope(initial));
  const [accrualMode, setAccrualMode] = useState<AccrualMode>(
    initial?.accrual_mode ?? "proportional",
  );
  const [thresholdType, setThresholdType] = useState<ThresholdType>(
    initial?.threshold_type ?? "payment_count",
  );
  const [tiers, setTiers] = useState<TierDraft[]>(() =>
    initial && initial.tiers.length > 0
      ? initial.tiers.map((t) => ({ ...t }))
      : [DEFAULT_TIER],
  );

  useEffect(() => {
    if (state && "ok" in state && state.ok) onSuccess?.();
  }, [state, onSuccess]);

  function addTier() {
    setTiers((prev) => {
      const last = prev[prev.length - 1]!;
      // El último deja de ser "sin tope" automáticamente: lo cerramos en su
      // min_count + 4 como sugerencia, y el nuevo arranca a partir de ahí
      // sin tope.
      const closedLastMax = last.max_count ?? last.min_count + 4;
      const updated = prev.map((t, i) =>
        i === prev.length - 1 ? { ...t, max_count: closedLastMax } : t,
      );
      const nextMin = closedLastMax + 1;
      return [
        ...updated,
        { min_count: nextMin, max_count: null, type: last.type, value: last.value },
      ];
    });
  }

  function removeTier(idx: number) {
    setTiers((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((_, i) => i !== idx);
      // El nuevo último siempre sin tope, así no quedamos con un "tier final"
      // con tope que dejaría ventas sin matchear.
      return next.map((t, i) =>
        i === next.length - 1 ? { ...t, max_count: null } : t,
      );
    });
  }

  function patchTier(idx: number, patch: Partial<TierDraft>) {
    setTiers((prev) => {
      const next = prev.map((t, i) => (i === idx ? { ...t, ...patch } : t));
      // Propagar bordes para mantener contigüidad: si tocaste max_count del
      // tramo i (no último), el i+1 arranca en max+1. Si tocaste min_count
      // del tramo i (no primero), el i-1 cierra en min-1.
      if (patch.max_count !== undefined && idx < next.length - 1) {
        const maxRaw = next[idx]!.max_count;
        if (maxRaw !== null) {
          next[idx + 1] = { ...next[idx + 1]!, min_count: maxRaw + 1 };
        }
      }
      if (patch.min_count !== undefined && idx > 0) {
        const minRaw = next[idx]!.min_count;
        next[idx - 1] = { ...next[idx - 1]!, max_count: minRaw - 1 };
      }
      return next;
    });
  }

  const activeModalities = modalities.filter((m) => m.active);
  const initialModalityIds = new Set(initial?.modality_ids ?? []);
  // Ocultamos productos inactivos EXCEPTO el actualmente asignado — así una
  // regla ligada a un producto que se desactivó sigue editable sin
  // desasignarlo por accidente.
  const visibleProducts = products.filter(
    (p) => p.active || p.id === initial?.product_id,
  );

  return (
    <form action={formAction} className="space-y-5">
      {/* Modalidades — multi-select via checkboxes */}
      <div>
        <Label>Modalidades * (podés elegir varias)</Label>
        <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-border bg-surface/40 p-2">
          {activeModalities.length === 0 ? (
            <p className="px-2 py-3 text-xs text-fg-subtle">
              No hay modalidades activas.
            </p>
          ) : (
            activeModalities.map((m) => (
              <label
                key={m.id}
                className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-bg-elevated"
              >
                <input
                  type="checkbox"
                  name="modality_ids"
                  value={m.id}
                  defaultChecked={initialModalityIds.has(m.id)}
                  className="h-4 w-4"
                />
                <span>{m.name}</span>
              </label>
            ))
          )}
        </div>
      </div>

      {/* Scope — mutuamente excluyente: default / launch / producto */}
      <div>
        <Label>Aplica a *</Label>
        <input type="hidden" name="scope" value={scope} />
        <div className="mt-1 space-y-2 rounded-md border border-border bg-surface/40 p-3 text-sm">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="scope_radio"
              checked={scope === "default"}
              onChange={() => setScope("default")}
              className="accent-accent"
            />
            <span>Default del proyecto para las modalidades elegidas</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="scope_radio"
              checked={scope === "launch"}
              onChange={() => setScope("launch")}
              className="accent-accent"
            />
            <span>Un lanzamiento específico</span>
          </label>
          {scope === "launch" && (
            <div className="ml-6">
              <Select
                id="rule-launch"
                name="launch_id"
                defaultValue={initial?.launch_id ?? ""}
                required
              >
                <option value="" disabled>
                  Elegí un lanzamiento
                </option>
                {launches.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="scope_radio"
              checked={scope === "product"}
              onChange={() => setScope("product")}
              className="accent-accent"
            />
            <span>Un producto específico</span>
          </label>
          {scope === "product" && (
            <div className="ml-6">
              <Select
                id="rule-product"
                name="product_id"
                defaultValue={initial?.product_id ?? ""}
                required
              >
                <option value="" disabled>
                  Elegí un producto
                </option>
                {visibleProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {!p.active ? " (inactivo)" : ""}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
        <p className="mt-1 text-xs text-fg-subtle">
          Prioridad al calcular: producto → launch → default.
        </p>
      </div>

      {/* Accrual mode — radio con lenguaje operativo */}
      <div>
        <Label>¿Cuándo se libera la comisión? *</Label>
        <input type="hidden" name="accrual_mode" value={accrualMode} />
        <div className="mt-1 space-y-2 rounded-md border border-border bg-surface/40 p-3 text-sm">
          <AccrualRadio
            value="on_close"
            checked={accrualMode === "on_close"}
            onSelect={setAccrualMode}
            title="Al cerrar la venta"
            hint="Se acredita al momento del cierre, sin importar los cobros. Usalo para comisiones fijas por venta o % sobre el pactado que no dependen del cobro real."
          />
          <AccrualRadio
            value="proportional"
            checked={accrualMode === "proportional"}
            onSelect={setAccrualMode}
            title="A medida que entra plata"
            hint="Con cada cobro parcial se libera la porción correspondiente. Modelo clásico."
          />
          <AccrualRadio
            value="threshold_full"
            checked={accrualMode === "threshold_full"}
            onSelect={setAccrualMode}
            title="Al juntar X cobros → paga el total"
            hint="No se devenga nada hasta cruzar el umbral. Después libera el % completo sobre el total pactado."
          />
          <AccrualRadio
            value="threshold_proportional"
            checked={accrualMode === "threshold_proportional"}
            onSelect={setAccrualMode}
            title="Al juntar X cobros → proporcional"
            hint="No se devenga hasta cruzar el umbral. Después escala proporcional al cobrado."
          />
        </div>
      </div>

      {accrualMode !== "proportional" && accrualMode !== "on_close" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="threshold-type">Tipo de umbral *</Label>
            <Select
              id="threshold-type"
              name="threshold_type"
              value={thresholdType}
              onChange={(e) => setThresholdType(e.target.value as ThresholdType)}
            >
              <option value="payment_count">Cantidad de cobros</option>
              <option value="paid_ratio">% cobrado del total</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="threshold-value">
              {thresholdType === "payment_count"
                ? "Cantidad mínima de cobros"
                : "Ratio (0–1) — ej. 0.5 = 50%"}
            </Label>
            <Input
              id="threshold-value"
              name="threshold_value"
              type="number"
              step={thresholdType === "payment_count" ? "1" : "0.01"}
              min={thresholdType === "payment_count" ? "1" : "0.01"}
              max={thresholdType === "payment_count" ? undefined : "1"}
              required
              defaultValue={
                initial?.threshold_value !== null &&
                initial?.threshold_value !== undefined
                  ? String(initial.threshold_value)
                  : ""
              }
              placeholder={thresholdType === "payment_count" ? "3" : "0.5"}
            />
          </div>
        </div>
      )}

      {/* Tiers */}
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <Label>Tramos marginales por cantidad de ventas *</Label>
          <button
            type="button"
            onClick={addTier}
            className="text-xs text-accent hover:underline"
          >
            + Agregar tramo
          </button>
        </div>
        <p className="mb-2 text-xs text-fg-subtle">
          Los tramos son marginales: cada venta usa el tier que matchea su
          posición. La 1ra venta del closer en el launch es venta #1 (min=0).
          El último tramo queda sin tope.
        </p>
        <div className="space-y-2">
          {tiers.map((t, i) => {
            const isLast = i === tiers.length - 1;
            return (
              <div
                key={i}
                className="grid grid-cols-12 items-end gap-2 rounded-md border border-border bg-surface/30 p-2"
              >
                <input
                  type="hidden"
                  name={`tiers[${i}][min_count]`}
                  value={t.min_count}
                />
                <input
                  type="hidden"
                  name={`tiers[${i}][max_count]`}
                  value={t.max_count === null ? "" : t.max_count}
                />
                <input
                  type="hidden"
                  name={`tiers[${i}][type]`}
                  value={t.type}
                />
                <input
                  type="hidden"
                  name={`tiers[${i}][value]`}
                  value={t.value}
                />
                <div className="col-span-2">
                  <span className="text-xs text-fg-subtle">Desde venta</span>
                  {i === 0 ? (
                    <div className="mt-1 rounded border border-border bg-bg-elevated px-2 py-1 text-sm tabular-nums">
                      1
                    </div>
                  ) : (
                    <Input
                      type="number"
                      min={1}
                      value={t.min_count + 1}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const parsed = parseInt(raw, 10);
                        if (!Number.isFinite(parsed) || parsed < 1) return;
                        patchTier(i, { min_count: parsed - 1 });
                      }}
                    />
                  )}
                </div>
                <div className="col-span-2">
                  <span className="text-xs text-fg-subtle">Hasta venta</span>
                  <Input
                    type="number"
                    min={t.min_count + 1}
                    value={t.max_count === null ? "" : t.max_count + 1}
                    disabled={isLast}
                    placeholder={isLast ? "∞" : ""}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const parsed = raw === "" ? null : parseInt(raw, 10) - 1;
                      patchTier(i, {
                        max_count: parsed === null || Number.isNaN(parsed) ? null : parsed,
                      });
                    }}
                  />
                </div>
                <div className="col-span-3">
                  <span className="text-xs text-fg-subtle">Tipo</span>
                  <Select
                    value={t.type}
                    onChange={(e) =>
                      patchTier(i, { type: e.target.value as CommissionTierType })
                    }
                  >
                    <option value="percent">% del cobrado</option>
                    <option value="fixed">Monto fijo</option>
                  </Select>
                </div>
                <div className="col-span-3">
                  <span className="text-xs text-fg-subtle">
                    {t.type === "percent" ? "%" : "Monto"}
                  </span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={t.value}
                    onChange={(e) =>
                      patchTier(i, { value: parseFloat(e.target.value) || 0 })
                    }
                  />
                </div>
                <div className="col-span-2 flex justify-end">
                  {tiers.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeTier(i)}
                      aria-label={`Quitar tramo ${i + 1}`}
                      className="rounded-md border border-border bg-bg-elevated px-2 py-1 text-xs text-fg-muted hover:text-error"
                    >
                      Quitar
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-4 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : submitLabel}
        </Button>
        {state && "error" in state && <FieldError>{state.error}</FieldError>}
      </div>
    </form>
  );
}

/**
 * Radio "amigable" para el modo de devengamiento. Muestra título + hint
 * debajo para que el operador entienda cuándo elegir cada opción sin
 * memorizar terminología técnica.
 */
function AccrualRadio({
  value,
  checked,
  onSelect,
  title,
  hint,
}: {
  readonly value: AccrualMode;
  readonly checked: boolean;
  readonly onSelect: (v: AccrualMode) => void;
  readonly title: string;
  readonly hint: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2">
      <input
        type="radio"
        name="accrual_mode_radio"
        checked={checked}
        onChange={() => onSelect(value)}
        className="mt-1 accent-accent"
      />
      <div>
        <div className="text-fg">{title}</div>
        <div className="text-xs text-fg-subtle">{hint}</div>
      </div>
    </label>
  );
}
