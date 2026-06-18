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

export function RuleForm({
  action,
  modalities,
  launches,
  submitLabel,
  onSuccess,
  initial,
}: {
  readonly action: FormAction;
  readonly modalities: ReadonlyArray<PaymentModalityRow>;
  readonly launches: ReadonlyArray<{ id: string; name: string }>;
  readonly submitLabel: string;
  readonly onSuccess?: () => void;
  readonly initial?: RuleInitial;
}) {
  const [state, formAction, pending] = useActionState<CommissionActionState, FormData>(
    action,
    null,
  );

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

      {/* Launch override */}
      <div>
        <Label htmlFor="rule-launch">Lanzamiento (opcional, override)</Label>
        <Select
          id="rule-launch"
          name="launch_id"
          defaultValue={initial?.launch_id ?? ""}
        >
          <option value="">— Regla default del proyecto —</option>
          {launches.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
        <p className="mt-1 text-xs text-fg-subtle">
          Si elegís un lanzamiento, esta regla pisa la default para ese launch.
        </p>
      </div>

      {/* Accrual mode */}
      <div>
        <Label htmlFor="rule-accrual">Devengamiento *</Label>
        <Select
          id="rule-accrual"
          name="accrual_mode"
          value={accrualMode}
          onChange={(e) => setAccrualMode(e.target.value as AccrualMode)}
        >
          <option value="proportional">Proporcional al cobrado</option>
          <option value="threshold_full">Umbral → sobre el total pactado</option>
          <option value="threshold_proportional">Umbral → proporcional al cobrado</option>
        </Select>
        <p className="mt-1 text-xs text-fg-subtle">
          {accrualMode === "proportional"
            ? "Se devenga proporcional al avance del cobro (modelo clásico)."
            : accrualMode === "threshold_full"
            ? "No se devenga nada hasta cruzar el umbral; al cruzarlo libera el % sobre el TOTAL pactado de la venta."
            : "No se devenga hasta cruzar el umbral; después escala proporcional al cobrado."}
        </p>
      </div>

      {accrualMode !== "proportional" && (
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
