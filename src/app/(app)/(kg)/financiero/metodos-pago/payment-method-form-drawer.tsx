"use client";

import { useActionState, useEffect, useMemo, useState } from "react";

import { Drawer } from "@/components/kg/drawer";

import {
  createPaymentMethod,
  updatePaymentMethod,
  type CreatePaymentMethodState,
  type UpdatePaymentMethodState,
} from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer compartido create / edit — mismo patrón que BankFormDrawer.
//
// En edición el projectId QUEDA FIJO (no se puede cambiar; ver comentario
// en updatePaymentMethod). Igual mando el value en el form para que el
// action lo tenga en el payload, pero renderizamos disabled y con nota.
// ═══════════════════════════════════════════════════════════════════════════

export interface ProjectOption {
  readonly id: string;
  readonly name: string;
}

export interface BankOption {
  readonly id: string;
  readonly name: string;
  readonly currency: "ARS" | "USD";
  readonly active: boolean;
}

export interface PaymentMethodInitial {
  readonly id?: string;
  readonly projectId?: string;
  readonly name?: string;
  readonly bankId?: string | null;
  /** Solo relevante para métodos sin banco. */
  readonly currency?: "ARS" | "USD" | null;
}

export interface PaymentMethodFormDrawerProps {
  readonly mode: "create" | "edit";
  readonly initial?: PaymentMethodInitial;
  readonly projects: readonly ProjectOption[];
  readonly banks: readonly BankOption[];
  readonly open: boolean;
  readonly onClose: () => void;
}

export function PaymentMethodFormDrawer(props: PaymentMethodFormDrawerProps) {
  if (!props.open) return null;
  const title =
    props.mode === "create" ? "Nuevo método de pago" : "Editar método de pago";
  return (
    <Drawer open={props.open} onClose={props.onClose} title={title} width={480}>
      <FormBody {...props} />
    </Drawer>
  );
}

function FormBody({
  mode,
  initial,
  projects,
  banks,
  onClose,
}: PaymentMethodFormDrawerProps) {
  const isEdit = mode === "edit" && initial?.id;
  const updateBound = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id!;
    return async (prev: UpdatePaymentMethodState, fd: FormData) =>
      updatePaymentMethod(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createFormAction, createPending] =
    useActionState<CreatePaymentMethodState, FormData>(
      createPaymentMethod,
      null,
    );
  const [updateState, updateFormAction, updatePending] =
    useActionState<UpdatePaymentMethodState, FormData>(
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

  const submitLabel = mode === "create" ? "Crear método" : "Guardar cambios";

  // Bancos disponibles en el selector: activos + el que ya tenga asignado el
  // método (aunque esté inactivo, para que la UI no lo pierda). Mismo criterio
  // que el form de LaunchOS que reemplazamos.
  const banksForSelect = banks.filter(
    (b) => b.active || b.id === initial?.bankId,
  );

  // Bank id controlado: cuando pasa a "sin banco" mostramos el selector de
  // moneda (efectivo/otros necesita explicitar ARS o USD porque no puede
  // heredar de ningún banco). Con banco elegido, ocultamos el select — la
  // moneda efectiva la resuelve el helper via bank.currency.
  const [selectedBankId, setSelectedBankId] = useState<string>(
    initial?.bankId ?? "",
  );
  const requiresCurrency = selectedBankId === "";

  return (
    <form
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <Field label="Proyecto" htmlFor="project_id" required>
        <select
          id="project_id"
          name="project_id"
          required
          defaultValue={initial?.projectId ?? ""}
          disabled={isEdit ? true : false}
          style={{
            ...inputStyle,
            opacity: isEdit ? 0.7 : 1,
            cursor: isEdit ? "not-allowed" : "auto",
          }}
        >
          {!isEdit && <option value="">Elegí un proyecto…</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {isEdit && (
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-3)", marginTop: 6 }}
          >
            No se puede cambiar el proyecto de un método existente. Si hace
            falta, desactivá este método y creá uno nuevo en el proyecto
            correcto.
          </div>
        )}
      </Field>

      <Field label="Nombre" htmlFor="name" required>
        <input
          id="name"
          name="name"
          type="text"
          required
          defaultValue={initial?.name ?? ""}
          placeholder="Ej. Transferencia bancaria, Stripe, Mercado Pago, Efectivo"
          autoComplete="off"
          style={inputStyle}
        />
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginTop: 6 }}
        >
          Único por proyecto.
        </div>
      </Field>

      <Field label="Banco destino" htmlFor="bank_id">
        <select
          id="bank_id"
          name="bank_id"
          value={selectedBankId}
          onChange={(e) => setSelectedBankId(e.target.value)}
          style={inputStyle}
        >
          <option value="">Sin banco (efectivo, en mano)</option>
          {banksForSelect.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} — {b.currency}
              {!b.active ? " (inactivo)" : ""}
            </option>
          ))}
        </select>
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginTop: 6 }}
        >
          Los cobros por este método suman al saldo del banco elegido y se
          cargan en la moneda del banco. Sin banco: no impacta ningún saldo
          (efectivo en mano, histórico sin backfill).
        </div>
      </Field>

      {requiresCurrency && (
        <Field label="Moneda del método" htmlFor="currency" required>
          <select
            id="currency"
            name="currency"
            required
            defaultValue={initial?.currency ?? "ARS"}
            style={inputStyle}
          >
            <option value="ARS">ARS — Pesos argentinos</option>
            <option value="USD">USD — Dólares</option>
          </select>
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-3)", marginTop: 6 }}
          >
            Obligatorio cuando no hay banco: define en qué moneda se cargan los
            cobros de este método (necesario para consolidar en USD).
          </div>
        </Field>
      )}

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
