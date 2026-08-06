"use client";

import { useActionState, useEffect, useMemo, useState } from "react";

import { Drawer } from "@/components/kg/drawer";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  type ExpenseCategory,
} from "@/lib/finance/expense-categories";
import { fMoney } from "@/lib/finance/format";

import {
  createExpense,
  updateExpense,
  type CreateExpenseState,
  type UpdateExpenseState,
} from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer compartido create / edit
// ═══════════════════════════════════════════════════════════════════════════
//
// UN solo componente para las dos operaciones. `mode='create'` monta el form
// con defaults; `mode='edit'` prepobla con `initial`. La única diferencia
// funcional es la action que se llama al submit.
//
// Se usa el `Drawer` KG (bloque 6c-c) por consistencia con el módulo. Los
// campos de `initial` son opcionales — un `initial={}` en create equivale a
// no pasarlo.
//
// paid_at y bank_movement_id NO se editan desde acá. Ese flujo va por
// linkExpenseToPayment / unlinkExpensePayment.

export interface ExpenseInitial {
  readonly id?: string;
  readonly description?: string;
  readonly category?: string | null;
  readonly amountGross?: number;
  readonly taxAmount?: number;
  readonly currency?: string;
  readonly expenseDate?: string;
  readonly dueDate?: string | null;
  readonly notes?: string | null;
  readonly transactionNumber?: string | null;
}

export interface ExpenseFormDrawerProps {
  readonly mode: "create" | "edit";
  readonly initial?: ExpenseInitial;
  readonly open: boolean;
  readonly onClose: () => void;
}

export function ExpenseFormDrawer({
  mode,
  initial,
  open,
  onClose,
}: ExpenseFormDrawerProps) {
  const title = mode === "create" ? "Nuevo gasto" : "Editar gasto";
  const submitLabel = mode === "create" ? "Crear gasto" : "Guardar cambios";

  if (!open) return null;
  return (
    <Drawer open={open} onClose={onClose} title={title} width={520}>
      <ExpenseFormBody
        mode={mode}
        initial={initial}
        onClose={onClose}
        submitLabel={submitLabel}
      />
    </Drawer>
  );
}

function ExpenseFormBody({
  mode,
  initial,
  onClose,
  submitLabel,
}: {
  readonly mode: "create" | "edit";
  readonly initial?: ExpenseInitial;
  readonly onClose: () => void;
  readonly submitLabel: string;
}) {
  const isEdit = mode === "edit" && initial?.id;

  // useActionState — patrón del repo (personas/, rotate-rule). En edit
  // pasamos un wrapper que fija el expenseId.
  const createBound = createExpense;
  const updateBound = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id!;
    return async (prev: UpdateExpenseState, fd: FormData) =>
      updateExpense(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createFormAction, createPending] =
    useActionState<CreateExpenseState, FormData>(createBound, null);
  const [updateState, updateFormAction, updatePending] =
    useActionState<UpdateExpenseState, FormData>(
      updateBound ??
        (async () => ({ error: "Modo edit sin id" as string }) as never),
      null,
    );

  const state = isEdit ? updateState : createState;
  const formAction = isEdit ? updateFormAction : createFormAction;
  const pending = isEdit ? updatePending : createPending;

  // Cerrar el drawer cuando el submit terminó OK. Same patrón que personas.
  useEffect(() => {
    if (state && "ok" in state && state.ok) onClose();
  }, [state, onClose]);

  // Estado local para validación en cliente (IVA vs bruto). Espeja el CHECK
  // 0063 línea 75 — evita el round-trip al server para un error obvio.
  const [amountGrossStr, setAmountGrossStr] = useState<string>(
    initial?.amountGross != null ? String(initial.amountGross) : "",
  );
  const [taxAmountStr, setTaxAmountStr] = useState<string>(
    initial?.taxAmount != null ? String(initial.taxAmount) : "0",
  );

  const amountGross = Number(amountGrossStr);
  const taxAmount = Number(taxAmountStr);
  const taxTooHigh =
    Number.isFinite(amountGross) &&
    Number.isFinite(taxAmount) &&
    taxAmount > amountGross;
  const amountNet =
    Number.isFinite(amountGross) && Number.isFinite(taxAmount)
      ? amountGross - taxAmount
      : null;

  return (
    <form
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <Field label="Descripción" htmlFor="description" required>
        <input
          id="description"
          name="description"
          type="text"
          required
          defaultValue={initial?.description ?? ""}
          placeholder="Ej. Alquiler oficina julio"
          autoComplete="off"
          style={inputStyle}
        />
      </Field>

      <Field label="Categoría" htmlFor="category">
        <select
          id="category"
          name="category"
          defaultValue={
            (initial?.category as ExpenseCategory | undefined) ?? "otros"
          }
          style={inputStyle}
        >
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {EXPENSE_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Monto bruto" htmlFor="amount_gross" required>
          <input
            id="amount_gross"
            name="amount_gross"
            type="number"
            step="0.01"
            min="0"
            required
            value={amountGrossStr}
            onChange={(e) => setAmountGrossStr(e.target.value)}
            placeholder="0.00"
            style={inputStyle}
          />
        </Field>
        <Field label="IVA" htmlFor="tax_amount">
          <input
            id="tax_amount"
            name="tax_amount"
            type="number"
            step="0.01"
            min="0"
            value={taxAmountStr}
            onChange={(e) => setTaxAmountStr(e.target.value)}
            placeholder="0.00"
            style={inputStyle}
          />
        </Field>
      </div>

      {amountNet != null && (
        <div
          className="kg-t7"
          style={{ color: taxTooHigh ? "#EF4444" : "var(--kg-text-3)" }}
        >
          {taxTooHigh
            ? `El IVA (${fMoney(taxAmount)}) supera el bruto (${fMoney(amountGross)}).`
            : `Neto: ${fMoney(amountNet)}`}
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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Fecha del gasto" htmlFor="expense_date" required>
          <input
            id="expense_date"
            name="expense_date"
            type="date"
            required
            defaultValue={initial?.expenseDate ?? todayYmd()}
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

      <Field label="Nº de transacción" htmlFor="transaction_number">
        <input
          id="transaction_number"
          name="transaction_number"
          type="text"
          defaultValue={initial?.transactionNumber ?? ""}
          placeholder="Opcional (comprobante del banco, para conciliar)"
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
          disabled={pending || taxTooHigh}
          className="kg-focus"
          style={{ ...primaryBtn, opacity: pending || taxTooHigh ? 0.7 : 1 }}
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

// ═══════════════════════════════════════════════════════════════════════════
// Sub-componentes internos
// ═══════════════════════════════════════════════════════════════════════════

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

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
