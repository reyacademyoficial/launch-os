"use client";

import { useActionState, useEffect, useMemo } from "react";

import { Drawer } from "@/components/kg/drawer";
import {
  LIABILITY_TYPES,
  LIABILITY_TYPE_LABELS,
  type LiabilityType,
} from "@/lib/finance/liability-types";

import {
  createLiability,
  updateLiability,
  type CreateLiabilityState,
  type UpdateLiabilityState,
} from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer compartido create / edit para pasivos.
//
// A diferencia de expenses (donde `paid_at` va por flujo separado con match a
// bank_movements), acá `settled_at` es un campo directo del form. Un pasivo
// puede saldarse por refinanciación o compensación, no siempre por dinero —
// exigir un link a bank_movement complicaría el caso común.
// ═══════════════════════════════════════════════════════════════════════════

export interface LiabilityInitial {
  readonly id?: string;
  readonly name?: string;
  readonly liabilityType?: string;
  readonly description?: string | null;
  readonly amount?: number;
  readonly currency?: string;
  readonly incurredAt?: string | null;
  readonly dueDate?: string | null;
  readonly settledAt?: string | null;
  readonly notes?: string | null;
}

export interface LiabilityFormDrawerProps {
  readonly mode: "create" | "edit";
  readonly initial?: LiabilityInitial;
  readonly open: boolean;
  readonly onClose: () => void;
}

export function LiabilityFormDrawer({
  mode,
  initial,
  open,
  onClose,
}: LiabilityFormDrawerProps) {
  if (!open) return null;
  const title = mode === "create" ? "Nuevo pasivo" : "Editar pasivo";
  return (
    <Drawer open={open} onClose={onClose} title={title} width={520}>
      <LiabilityFormBody mode={mode} initial={initial} onClose={onClose} />
    </Drawer>
  );
}

function LiabilityFormBody({
  mode,
  initial,
  onClose,
}: {
  readonly mode: "create" | "edit";
  readonly initial?: LiabilityInitial;
  readonly onClose: () => void;
}) {
  const isEdit = mode === "edit" && initial?.id;
  const updateBound = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id!;
    return async (prev: UpdateLiabilityState, fd: FormData) =>
      updateLiability(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createFormAction, createPending] =
    useActionState<CreateLiabilityState, FormData>(createLiability, null);
  const [updateState, updateFormAction, updatePending] =
    useActionState<UpdateLiabilityState, FormData>(
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

  const submitLabel = mode === "create" ? "Crear pasivo" : "Guardar cambios";

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
          placeholder="Ej. Préstamo Santander, IIBB julio, Aguinaldo devengado"
          autoComplete="off"
          style={inputStyle}
        />
      </Field>

      <Field label="Tipo" htmlFor="liability_type" required>
        <select
          id="liability_type"
          name="liability_type"
          defaultValue={
            (initial?.liabilityType as LiabilityType | undefined) ?? "otro"
          }
          style={inputStyle}
        >
          {LIABILITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {LIABILITY_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
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

      <Field label="Monto" htmlFor="amount" required>
        <input
          id="amount"
          name="amount"
          type="number"
          step="0.01"
          min="0"
          required
          defaultValue={initial?.amount ?? ""}
          placeholder="0.00"
          style={inputStyle}
        />
      </Field>

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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Incurrido" htmlFor="incurred_at">
          <input
            id="incurred_at"
            name="incurred_at"
            type="date"
            defaultValue={initial?.incurredAt ?? ""}
            style={inputStyle}
          />
        </Field>
        <Field label="Vencimiento" htmlFor="due_date">
          <input
            id="due_date"
            name="due_date"
            type="date"
            defaultValue={initial?.dueDate ?? ""}
            style={inputStyle}
          />
        </Field>
      </div>

      <Field label="Saldado" htmlFor="settled_at">
        <input
          id="settled_at"
          name="settled_at"
          type="date"
          defaultValue={initial?.settledAt ?? ""}
          style={inputStyle}
        />
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginTop: 6 }}
        >
          Si tiene fecha, el pasivo deja de restar del Patrimonio neto. Podés
          borrarla si te equivocaste.
        </div>
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
