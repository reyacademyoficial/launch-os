"use client";

import { useActionState, useEffect, useState } from "react";

import { Drawer } from "@/components/kg/drawer";
import type {
  AccrualMode,
  CommissionTierType,
  PaymentModalityRow,
  ThresholdType,
} from "@/lib/commissions/types";
import type { ProductRow } from "@/lib/products/types";

import type { CommissionActionState } from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer create / edit de commission_rule — estilo KG.
//
// Sustituye a rule-form + rule-modal. Lógica de tiers, scope XOR, threshold
// y devengo preservada tal cual del componente original — solo cambia el
// markup y los estilos (Drawer KG, inputStyle inline, primary/secondaryBtn).
// La lógica es larga pero probada; reescribir en TS puro es alto riesgo.
// ═══════════════════════════════════════════════════════════════════════════

type FormAction = (
  prev: CommissionActionState,
  formData: FormData,
) => Promise<CommissionActionState>;

interface TierDraft {
  min_count: number;
  max_count: number | null;
  type: CommissionTierType;
  value: number;
  /**
   * Moneda del `value` cuando `type='fixed'`. Ignorada al render en
   * `percent` (el % hereda la moneda de la venta) pero mantenemos el
   * campo para no perderlo cuando el usuario alterna entre tipos.
   */
  currency: "ARS" | "USD";
}

const DEFAULT_TIER: TierDraft = {
  min_count: 0,
  max_count: null,
  type: "percent",
  value: 10,
  currency: "ARS",
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
    currency: "ARS" | "USD";
  }>;
}

type RuleScope = "default" | "launch" | "product";

function initialScope(initial: RuleInitial | undefined): RuleScope {
  if (!initial) return "default";
  if (initial.launch_id) return "launch";
  if (initial.product_id) return "product";
  return "default";
}

export interface RuleFormDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly submitLabel: string;
  readonly action: FormAction;
  readonly modalities: ReadonlyArray<PaymentModalityRow>;
  readonly launches: ReadonlyArray<{ id: string; name: string }>;
  readonly products: ReadonlyArray<ProductRow>;
  readonly initial?: RuleInitial;
}

export function RuleFormDrawer(props: RuleFormDrawerProps) {
  if (!props.open) return null;
  return (
    <Drawer
      open={props.open}
      onClose={props.onClose}
      title={props.title}
      width={620}
    >
      <FormBody {...props} />
    </Drawer>
  );
}

function FormBody({
  action,
  modalities,
  launches,
  products,
  submitLabel,
  onClose,
  initial,
}: RuleFormDrawerProps) {
  const [state, formAction, pending] = useActionState<
    CommissionActionState,
    FormData
  >(action, null);

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
    if (state && "ok" in state && state.ok) onClose();
  }, [state, onClose]);

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
        {
          min_count: nextMin,
          max_count: null,
          type: last.type,
          value: last.value,
          currency: last.currency,
        },
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
  const visibleProducts = products.filter(
    (p) => p.active || p.id === initial?.product_id,
  );

  return (
    <form
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 20 }}
    >
      {/* Modalidades — multi-select via checkboxes */}
      <div>
        <FieldLabel>Modalidades (podés elegir varias) *</FieldLabel>
        <div
          style={{
            marginTop: 6,
            maxHeight: 160,
            overflowY: "auto",
            borderRadius: "var(--kg-r-8)",
            border: "1px solid var(--kg-border-subtle)",
            background: "var(--kg-surface-2-solid)",
            padding: 8,
          }}
        >
          {activeModalities.length === 0 ? (
            <p style={{ padding: "8px 4px", fontSize: 11, color: "var(--kg-text-3)" }}>
              No hay modalidades activas.
            </p>
          ) : (
            activeModalities.map((m) => (
              <label
                key={m.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "4px 8px",
                  borderRadius: 4,
                  fontSize: 13,
                  color: "var(--kg-text-1)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  name="modality_ids"
                  value={m.id}
                  defaultChecked={initialModalityIds.has(m.id)}
                  style={{ accentColor: "var(--kg-accent-500)" }}
                />
                <span>{m.name}</span>
              </label>
            ))
          )}
        </div>
      </div>

      {/* Scope — mutuamente excluyente */}
      <div>
        <FieldLabel>Aplica a *</FieldLabel>
        <input type="hidden" name="scope" value={scope} />
        <div
          style={{
            marginTop: 6,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            borderRadius: "var(--kg-r-8)",
            border: "1px solid var(--kg-border-subtle)",
            background: "var(--kg-surface-2-solid)",
            padding: 12,
            fontSize: 13,
          }}
        >
          <ScopeRadio
            checked={scope === "default"}
            onSelect={() => setScope("default")}
            label="Default del proyecto para las modalidades elegidas"
          />
          <ScopeRadio
            checked={scope === "launch"}
            onSelect={() => setScope("launch")}
            label="Un lanzamiento específico"
          />
          {scope === "launch" && (
            <div style={{ marginLeft: 24 }}>
              <select
                id="rule-launch"
                name="launch_id"
                defaultValue={initial?.launch_id ?? ""}
                required
                style={inputStyle}
              >
                <option value="" disabled>
                  Elegí un lanzamiento
                </option>
                {launches.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <ScopeRadio
            checked={scope === "product"}
            onSelect={() => setScope("product")}
            label="Un producto específico"
          />
          {scope === "product" && (
            <div style={{ marginLeft: 24 }}>
              <select
                id="rule-product"
                name="product_id"
                defaultValue={initial?.product_id ?? ""}
                required
                style={inputStyle}
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
              </select>
            </div>
          )}
        </div>
        <div className="kg-t7" style={{ color: "var(--kg-text-3)", marginTop: 6 }}>
          Prioridad al calcular: producto → launch → default.
        </div>
      </div>

      {/* Accrual mode — radio con lenguaje operativo */}
      <div>
        <FieldLabel>¿Cuándo se libera la comisión? *</FieldLabel>
        <input type="hidden" name="accrual_mode" value={accrualMode} />
        <div
          style={{
            marginTop: 6,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            borderRadius: "var(--kg-r-8)",
            border: "1px solid var(--kg-border-subtle)",
            background: "var(--kg-surface-2-solid)",
            padding: 12,
            fontSize: 13,
          }}
        >
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
        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "1fr 1fr",
          }}
        >
          <div>
            <FieldLabel htmlFor="threshold-type">Tipo de umbral *</FieldLabel>
            <select
              id="threshold-type"
              name="threshold_type"
              value={thresholdType}
              onChange={(e) => setThresholdType(e.target.value as ThresholdType)}
              style={inputStyle}
            >
              <option value="payment_count">Cantidad de cobros</option>
              <option value="paid_ratio">% cobrado del total</option>
            </select>
          </div>
          <div>
            <FieldLabel htmlFor="threshold-value">
              {thresholdType === "payment_count"
                ? "Cantidad mínima de cobros"
                : "Ratio (0–1) — ej. 0.5 = 50%"}
            </FieldLabel>
            <input
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
              style={inputStyle}
            />
          </div>
        </div>
      )}

      {/* Tiers */}
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: 6,
          }}
        >
          <FieldLabel>Tramos marginales por cantidad de ventas *</FieldLabel>
          <button
            type="button"
            onClick={addTier}
            className="kg-focus"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--kg-accent-text)",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              padding: 0,
            }}
          >
            + Agregar tramo
          </button>
        </div>
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginBottom: 8 }}
        >
          Los tramos son marginales: cada venta usa el tier que matchea su
          posición. La 1ra venta del closer en el launch es venta #1 (min=0).
          El último tramo queda sin tope.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {tiers.map((t, i) => {
            const isLast = i === tiers.length - 1;
            return (
              <div
                key={i}
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(12, 1fr)",
                  gap: 8,
                  alignItems: "end",
                  borderRadius: "var(--kg-r-8)",
                  border: "1px solid var(--kg-border-subtle)",
                  background: "var(--kg-surface-2-solid)",
                  padding: 10,
                }}
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
                <input
                  type="hidden"
                  name={`tiers[${i}][currency]`}
                  value={t.currency}
                />
                <div style={{ gridColumn: "span 2" }}>
                  <span className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
                    Desde venta
                  </span>
                  {i === 0 ? (
                    <div
                      style={{
                        marginTop: 4,
                        padding: "6px 10px",
                        borderRadius: "var(--kg-r-8)",
                        border: "1px solid var(--kg-border-subtle)",
                        background: "var(--kg-surface-1-solid)",
                        fontSize: 12.5,
                        color: "var(--kg-text-2)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      1
                    </div>
                  ) : (
                    <input
                      type="number"
                      min={1}
                      value={t.min_count + 1}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const parsed = parseInt(raw, 10);
                        if (!Number.isFinite(parsed) || parsed < 1) return;
                        patchTier(i, { min_count: parsed - 1 });
                      }}
                      style={{ ...inputStyle, marginTop: 4 }}
                    />
                  )}
                </div>
                <div style={{ gridColumn: "span 2" }}>
                  <span className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
                    Hasta venta
                  </span>
                  <input
                    type="number"
                    min={t.min_count + 1}
                    value={t.max_count === null ? "" : t.max_count + 1}
                    disabled={isLast}
                    placeholder={isLast ? "∞" : ""}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const parsed =
                        raw === "" ? null : parseInt(raw, 10) - 1;
                      patchTier(i, {
                        max_count:
                          parsed === null || Number.isNaN(parsed) ? null : parsed,
                      });
                    }}
                    style={{
                      ...inputStyle,
                      marginTop: 4,
                      opacity: isLast ? 0.6 : 1,
                    }}
                  />
                </div>
                <div style={{ gridColumn: "span 3" }}>
                  <span className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
                    Tipo
                  </span>
                  <select
                    value={t.type}
                    onChange={(e) =>
                      patchTier(i, {
                        type: e.target.value as CommissionTierType,
                      })
                    }
                    style={{ ...inputStyle, marginTop: 4 }}
                  >
                    <option value="percent">% del cobrado</option>
                    <option value="fixed">Monto fijo</option>
                  </select>
                </div>
                <div
                  style={{
                    gridColumn: t.type === "fixed" ? "span 2" : "span 3",
                  }}
                >
                  <span className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
                    {t.type === "percent" ? "%" : "Monto"}
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={t.value}
                    onChange={(e) =>
                      patchTier(i, { value: parseFloat(e.target.value) || 0 })
                    }
                    style={{ ...inputStyle, marginTop: 4 }}
                  />
                </div>
                {t.type === "fixed" && (
                  <div style={{ gridColumn: "span 1" }}>
                    <span
                      className="kg-t7"
                      style={{ color: "var(--kg-text-3)" }}
                    >
                      Moneda
                    </span>
                    <select
                      value={t.currency}
                      onChange={(e) =>
                        patchTier(i, {
                          currency: e.target.value as "ARS" | "USD",
                        })
                      }
                      aria-label="Moneda del monto fijo"
                      style={{ ...inputStyle, marginTop: 4 }}
                    >
                      <option value="ARS">AR$</option>
                      <option value="USD">US$</option>
                    </select>
                  </div>
                )}
                <div
                  style={{
                    gridColumn: "span 2",
                    display: "flex",
                    justifyContent: "flex-end",
                  }}
                >
                  {tiers.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeTier(i)}
                      aria-label={`Quitar tramo ${i + 1}`}
                      className="kg-focus"
                      style={{
                        padding: "4px 10px",
                        borderRadius: 999,
                        background: "transparent",
                        border: "1px solid var(--kg-border-subtle)",
                        color: "#EF4444",
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
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

      {state && "error" in state && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: "var(--kg-r-8)",
            background: "rgba(239,68,68,0.10)",
            border: "1px solid #EF4444",
            color: "#EF4444",
            fontSize: 12,
          }}
        >
          {state.error}
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          marginTop: 4,
        }}
      >
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="kg-focus"
          style={secondaryBtn}
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={pending}
          className="kg-focus"
          style={{ ...primaryBtn, opacity: pending ? 0.7 : 1 }}
        >
          {pending ? "Guardando…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

// ─── Sub-componentes ─────────────────────────────────────────────────────

function FieldLabel({
  htmlFor,
  children,
}: {
  readonly htmlFor?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="kg-t7"
      style={{ display: "block", color: "var(--kg-text-3)", marginBottom: 6 }}
    >
      {children}
    </label>
  );
}

function ScopeRadio({
  checked,
  onSelect,
  label,
}: {
  readonly checked: boolean;
  readonly onSelect: () => void;
  readonly label: string;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        cursor: "pointer",
        color: "var(--kg-text-1)",
      }}
    >
      <input
        type="radio"
        name="scope_radio"
        checked={checked}
        onChange={onSelect}
        style={{ accentColor: "var(--kg-accent-500)" }}
      />
      <span>{label}</span>
    </label>
  );
}

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
    <label
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        cursor: "pointer",
      }}
    >
      <input
        type="radio"
        name="accrual_mode_radio"
        checked={checked}
        onChange={() => onSelect(value)}
        style={{
          accentColor: "var(--kg-accent-500)",
          marginTop: 3,
        }}
      />
      <div>
        <div style={{ color: "var(--kg-text-1)" }}>{title}</div>
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginTop: 2 }}
        >
          {hint}
        </div>
      </div>
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  borderRadius: "var(--kg-r-8)",
  background: "var(--kg-surface-1-solid)",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-1)",
  fontSize: 12.5,
};

const primaryBtn: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 999,
  background: "var(--kg-accent-500)",
  border: "none",
  color: "#fff",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryBtn: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};
