"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";

import { Drawer } from "@/components/kg/drawer";

import {
  createBankMovement,
  deleteBankMovement,
  updateBankMovement,
  type CreateBankMovementState,
  type UpdateBankMovementState,
} from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer compartido create / edit para bank_movements.
//
// En edición: el `bank_id` queda FIJO (mismo criterio que updatePaymentMethod
// respecto a project_id). Se renderiza disabled con nota.
// ═══════════════════════════════════════════════════════════════════════════

export interface BankOption {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
}

export interface MovementInitial {
  readonly id?: string;
  readonly bankId?: string;
  readonly bankName?: string;
  readonly kind?: "in" | "out";
  readonly amount?: number;
  readonly occurredAt?: string;
  readonly description?: string | null;
}

export interface MovementFormDrawerProps {
  readonly mode: "create" | "edit";
  readonly initial?: MovementInitial;
  readonly banks: readonly BankOption[];
  readonly open: boolean;
  readonly onClose: () => void;
}

export function MovementFormDrawer(props: MovementFormDrawerProps) {
  if (!props.open) return null;
  const title =
    props.mode === "create" ? "Nuevo movimiento bancario" : "Editar movimiento";
  return (
    <Drawer open={props.open} onClose={props.onClose} title={title} width={520}>
      <FormBody {...props} />
    </Drawer>
  );
}

function FormBody({
  mode,
  initial,
  banks,
  onClose,
}: MovementFormDrawerProps) {
  const isEdit = mode === "edit" && initial?.id;

  const updateBound = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id!;
    return async (prev: UpdateBankMovementState, fd: FormData) =>
      updateBankMovement(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createFormAction, createPending] =
    useActionState<CreateBankMovementState, FormData>(
      createBankMovement,
      null,
    );
  const [updateState, updateFormAction, updatePending] =
    useActionState<UpdateBankMovementState, FormData>(
      updateBound ??
        (async () => ({ error: "Modo edit sin id" as string }) as never),
      null,
    );

  const state = isEdit ? updateState : createState;
  const formAction = isEdit ? updateFormAction : createFormAction;
  const pending = isEdit ? updatePending : createPending;

  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletePending, startDelete] = useTransition();

  useEffect(() => {
    if (state && "ok" in state && state.ok) onClose();
  }, [state, onClose]);

  function handleDelete() {
    if (!isEdit) return;
    const id = initial!.id!;
    // Confirm nativo — mismo patrón que metodos-pago. El server rechaza si
    // hay links a expenses/invoices/payroll/client_transfers.
    if (
      !confirm(
        "¿Eliminar este movimiento bancario? Esta acción es irreversible y solo funciona si no está vinculado a gastos, facturas, nómina ni transferencias.",
      )
    ) {
      return;
    }
    setDeleteError(null);
    startDelete(async () => {
      const r = await deleteBankMovement(id);
      if ("error" in r) {
        setDeleteError(r.error);
        return;
      }
      onClose();
    });
  }

  const submitLabel = mode === "create" ? "Crear movimiento" : "Guardar cambios";

  const banksForSelect = banks.filter(
    (b) => b.active || b.id === initial?.bankId,
  );

  return (
    <form
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <Field label="Banco" htmlFor="bank_id" required>
        <select
          id="bank_id"
          name="bank_id"
          required
          defaultValue={initial?.bankId ?? ""}
          disabled={isEdit ? true : false}
          style={{
            ...inputStyle,
            opacity: isEdit ? 0.7 : 1,
            cursor: isEdit ? "not-allowed" : "auto",
          }}
        >
          {!isEdit && <option value="">Elegí un banco…</option>}
          {banksForSelect.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
              {!b.active ? " (inactivo)" : ""}
            </option>
          ))}
        </select>
        {isEdit && (
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-3)", marginTop: 6 }}
          >
            El banco de un movimiento no se puede cambiar. Si te equivocaste,
            editá el resto de los datos o creá uno nuevo en el banco correcto.
          </div>
        )}
      </Field>

      <Field label="Tipo" htmlFor="kind" required>
        <select
          id="kind"
          name="kind"
          required
          defaultValue={initial?.kind ?? "out"}
          style={inputStyle}
        >
          <option value="in">Entrada (ingreso)</option>
          <option value="out">Salida (egreso)</option>
        </select>
      </Field>

      <Field label="Monto" htmlFor="amount" required>
        <input
          id="amount"
          name="amount"
          type="number"
          step="0.01"
          min="0.01"
          required
          defaultValue={initial?.amount ?? ""}
          placeholder="0.00"
          style={inputStyle}
        />
      </Field>

      <Field label="Fecha" htmlFor="occurred_at" required>
        <input
          id="occurred_at"
          name="occurred_at"
          type="date"
          required
          defaultValue={initial?.occurredAt ?? todayYmd()}
          style={inputStyle}
        />
      </Field>

      <Field label="Descripción" htmlFor="description">
        <input
          id="description"
          name="description"
          type="text"
          defaultValue={initial?.description ?? ""}
          placeholder="Ej. Pago Metricool, transferencia a proveedor"
          style={inputStyle}
        />
      </Field>

      {(state && "error" in state) || deleteError ? (
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
          {deleteError ?? (state as { error: string }).error}
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          justifyContent: isEdit ? "space-between" : "flex-end",
          gap: 8,
          marginTop: 4,
          alignItems: "center",
        }}
      >
        {isEdit && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending || deletePending}
            className="kg-focus"
            style={{
              ...secondaryBtn,
              color: "#EF4444",
              borderColor: "#EF4444",
              opacity: pending || deletePending ? 0.6 : 1,
            }}
            title="Eliminar movimiento"
          >
            {deletePending ? "Eliminando…" : "Eliminar"}
          </button>
        )}
        <div style={{ display: "inline-flex", gap: 8, marginLeft: "auto" }}>
          <button
            type="button"
            onClick={onClose}
            disabled={pending || deletePending}
            className="kg-focus"
            style={secondaryBtn}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={pending || deletePending}
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

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
