"use client";

import { useActionState, useEffect, useMemo, useState } from "react";

import { Drawer } from "@/components/kg/drawer";
import {
  ASSET_TYPES,
  ASSET_TYPE_LABELS,
  type AssetType,
} from "@/lib/finance/asset-types";
import { fMoney } from "@/lib/finance/format";

import {
  createAsset,
  updateAsset,
  type CreateAssetState,
  type UpdateAssetState,
} from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer compartido create / edit — mismo patrón que ExpenseFormDrawer.
// ═══════════════════════════════════════════════════════════════════════════

export interface AssetInitial {
  readonly id?: string;
  readonly name?: string;
  readonly assetType?: string;
  readonly description?: string | null;
  readonly amount?: number;
  readonly originalCost?: number | null;
  readonly depreciation?: number;
  readonly currency?: string;
  readonly acquiredAt?: string | null;
  readonly notes?: string | null;
}

export interface AssetFormDrawerProps {
  readonly mode: "create" | "edit";
  readonly initial?: AssetInitial;
  readonly open: boolean;
  readonly onClose: () => void;
}

export function AssetFormDrawer({
  mode,
  initial,
  open,
  onClose,
}: AssetFormDrawerProps) {
  if (!open) return null;
  const title = mode === "create" ? "Nuevo activo" : "Editar activo";
  return (
    <Drawer open={open} onClose={onClose} title={title} width={520}>
      <AssetFormBody mode={mode} initial={initial} onClose={onClose} />
    </Drawer>
  );
}

function AssetFormBody({
  mode,
  initial,
  onClose,
}: {
  readonly mode: "create" | "edit";
  readonly initial?: AssetInitial;
  readonly onClose: () => void;
}) {
  const isEdit = mode === "edit" && initial?.id;
  const updateBound = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id!;
    return async (prev: UpdateAssetState, fd: FormData) =>
      updateAsset(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createFormAction, createPending] =
    useActionState<CreateAssetState, FormData>(createAsset, null);
  const [updateState, updateFormAction, updatePending] =
    useActionState<UpdateAssetState, FormData>(
      updateBound ??
        (async () => ({ error: "Modo edit sin id" as string }) as never),
      null,
    );

  const state = isEdit ? updateState : createState;
  const formAction = isEdit ? updateFormAction : createFormAction;
  const pending = isEdit ? updatePending : createPending;

  useEffect(() => {
    if (state && "ok" in state && state.ok) onClose();
  }, [state, onClose]);

  // Valor libros previsualizado en vivo si el usuario carga original + depre.
  // No es un requerimiento — el `amount` es SIEMPRE el que se guarda. Este
  // preview es una ayuda visual: "si depre es correcta, valor libros = X".
  const [amountStr, setAmountStr] = useState<string>(
    initial?.amount != null ? String(initial.amount) : "",
  );
  const [originalStr, setOriginalStr] = useState<string>(
    initial?.originalCost != null ? String(initial.originalCost) : "",
  );
  const [depreciationStr, setDepreciationStr] = useState<string>(
    initial?.depreciation != null ? String(initial.depreciation) : "0",
  );

  const original = Number(originalStr);
  const depreciation = Number(depreciationStr);
  const derivedBook =
    Number.isFinite(original) && Number.isFinite(depreciation) && original > 0
      ? original - depreciation
      : null;
  const amount = Number(amountStr);
  const bookMismatch =
    derivedBook != null &&
    Number.isFinite(amount) &&
    Math.abs(derivedBook - amount) > 0.01;

  const submitLabel = mode === "create" ? "Crear activo" : "Guardar cambios";

  return (
    <form
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <Field label="Nombre" htmlFor="name" required>
        <input
          id="name"
          name="name"
          type="text"
          required
          defaultValue={initial?.name ?? ""}
          placeholder="Ej. Mercado Pago, Notebook oficina, Oficina Belgrano"
          autoComplete="off"
          style={inputStyle}
        />
      </Field>

      <Field label="Tipo" htmlFor="asset_type" required>
        <select
          id="asset_type"
          name="asset_type"
          defaultValue={(initial?.assetType as AssetType | undefined) ?? "banco"}
          style={inputStyle}
        >
          {ASSET_TYPES.map((t) => (
            <option key={t} value={t}>
              {ASSET_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginTop: 6 }}
        >
          "Caja" y "Banco" alimentan la tarjeta Caja del dashboard financiero.
        </div>
      </Field>

      <Field label="Descripción" htmlFor="description">
        <input
          id="description"
          name="description"
          type="text"
          defaultValue={initial?.description ?? ""}
          placeholder="Opcional"
          style={inputStyle}
        />
      </Field>

      <Field label="Valor en libros" htmlFor="amount" required>
        <input
          id="amount"
          name="amount"
          type="number"
          step="0.01"
          min="0"
          required
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
          placeholder="0.00"
          style={inputStyle}
        />
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginTop: 6 }}
        >
          Para caja/banco: el saldo actual. Para bienes: el valor libros
          después de depreciaciones si aplica.
        </div>
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Costo original" htmlFor="original_cost">
          <input
            id="original_cost"
            name="original_cost"
            type="number"
            step="0.01"
            min="0"
            value={originalStr}
            onChange={(e) => setOriginalStr(e.target.value)}
            placeholder="Opcional"
            style={inputStyle}
          />
        </Field>
        <Field label="Depreciación acumulada" htmlFor="depreciation">
          <input
            id="depreciation"
            name="depreciation"
            type="number"
            step="0.01"
            min="0"
            value={depreciationStr}
            onChange={(e) => setDepreciationStr(e.target.value)}
            placeholder="0"
            style={inputStyle}
          />
        </Field>
      </div>

      {bookMismatch && (
        <div
          className="kg-t7"
          style={{
            color: "#FFB800",
            padding: "8px 12px",
            borderRadius: "var(--kg-r-8)",
            background: "rgba(255,184,0,0.10)",
            border: "1px solid #FFB800",
          }}
        >
          Aviso: costo original − depreciación ={" "}
          <strong>{fMoney(derivedBook!)}</strong>, distinto del valor en
          libros que cargaste ({fMoney(amount)}). No se bloquea — puede ser
          intencional (revalúo, deterioro).
        </div>
      )}

      <Field label="Moneda" htmlFor="currency">
        <select
          id="currency"
          name="currency"
          defaultValue={initial?.currency ?? "ARS"}
          style={inputStyle}
        >
          <option value="ARS">ARS</option>
          <option value="USD">USD</option>
          <option value="EUR">EUR</option>
        </select>
      </Field>

      <Field label="Fecha de adquisición" htmlFor="acquired_at">
        <input
          id="acquired_at"
          name="acquired_at"
          type="date"
          defaultValue={initial?.acquiredAt ?? ""}
          style={inputStyle}
        />
      </Field>

      <Field label="Notas" htmlFor="notes">
        <input
          id="notes"
          name="notes"
          type="text"
          defaultValue={initial?.notes ?? ""}
          placeholder="Opcional"
          style={inputStyle}
        />
      </Field>

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
          {pending
            ? mode === "create"
              ? "Creando…"
              : "Guardando…"
            : submitLabel}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  readonly label: string;
  readonly htmlFor: string;
  readonly required?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="kg-t7"
        style={{ display: "block", color: "var(--kg-text-3)", marginBottom: 6 }}
      >
        {label}
        {required && (
          <span aria-hidden="true" style={{ color: "#EF4444", marginLeft: 4 }}>
            *
          </span>
        )}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  borderRadius: "var(--kg-r-8)",
  background: "var(--kg-surface-2-solid)",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-1)",
  fontSize: 13,
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
