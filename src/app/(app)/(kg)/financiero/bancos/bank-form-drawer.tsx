"use client";

import { useActionState, useEffect, useMemo, useState } from "react";

import { Drawer } from "@/components/kg/drawer";

import {
  createBank,
  updateBank,
  type CreateBankState,
  type UpdateBankState,
} from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer compartido create / edit — mismo patrón que ExpenseFormDrawer /
// AssetFormDrawer. Form corto: name + opening_balance.
//
// `opening_balance` es el saldo del banco EN EL MOMENTO de arrancar a usar el
// sistema, no el saldo actual. Todos los cobros posteriores (vía
// payment_methods) y los bank_movements ajustan el total a partir de ahí.
// Editarlo cambia el punto de arranque y desplaza todos los saldos calculados.
//
// Post 0169: además puede marcarse como "cobro externo" (representa el banco
// por el que cobra un cliente externo). Cuando is_external_collector=true,
// external_project_id pasa a ser obligatorio; los dos flags son bicondicionales
// (CHECK `banks_external_collector_coherence` en DB).
// ═══════════════════════════════════════════════════════════════════════════

export interface BankInitial {
  readonly id?: string;
  readonly name?: string;
  readonly openingBalance?: number;
  readonly currency?: "ARS" | "USD";
  readonly isExternalCollector?: boolean;
  readonly externalProjectId?: string | null;
}

export interface BankFormProject {
  readonly id: string;
  readonly name: string;
}

export interface BankFormDrawerProps {
  readonly mode: "create" | "edit";
  readonly initial?: BankInitial;
  readonly projects: ReadonlyArray<BankFormProject>;
  readonly open: boolean;
  readonly onClose: () => void;
}

export function BankFormDrawer({
  mode,
  initial,
  projects,
  open,
  onClose,
}: BankFormDrawerProps) {
  if (!open) return null;
  const title = mode === "create" ? "Nuevo banco" : "Editar banco";
  return (
    <Drawer open={open} onClose={onClose} title={title} width={480}>
      <BankFormBody
        mode={mode}
        initial={initial}
        projects={projects}
        onClose={onClose}
      />
    </Drawer>
  );
}

function BankFormBody({
  mode,
  initial,
  projects,
  onClose,
}: {
  readonly mode: "create" | "edit";
  readonly initial?: BankInitial;
  readonly projects: ReadonlyArray<BankFormProject>;
  readonly onClose: () => void;
}) {
  const isEdit = mode === "edit" && initial?.id;
  const updateBound = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id!;
    return async (prev: UpdateBankState, fd: FormData) =>
      updateBank(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createFormAction, createPending] =
    useActionState<CreateBankState, FormData>(createBank, null);
  const [updateState, updateFormAction, updatePending] =
    useActionState<UpdateBankState, FormData>(
      updateBound ??
        (async () => ({ error: "Modo edit sin id" as string }) as never),
      null,
    );

  const state = isEdit ? updateState : createState;
  const formAction = isEdit ? updateFormAction : createFormAction;
  const pending = isEdit ? updatePending : createPending;

  // Estado local para el checkbox — controla la visibilidad del dropdown de
  // proyecto y su requiredness. El value se envía vía input hidden por
  // consistencia con el resto del form (server action lee formData).
  const [isExternal, setIsExternal] = useState<boolean>(
    initial?.isExternalCollector ?? false,
  );
  const [externalProjectId, setExternalProjectId] = useState<string>(
    initial?.externalProjectId ?? "",
  );

  useEffect(() => {
    if (state && "ok" in state && state.ok) onClose();
  }, [state, onClose]);

  const submitLabel = mode === "create" ? "Crear banco" : "Guardar cambios";

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
          placeholder="Ej. Mercado Pago, Santander, Stripe, Binance"
          autoComplete="off"
          style={inputStyle}
        />
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginTop: 6 }}
        >
          Único por organización. Si el nombre ya existe, la creación falla.
        </div>
      </Field>

      <Field label="Moneda" htmlFor="currency" required>
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
          Moneda nativa del banco. El saldo se muestra siempre en esta moneda
          para coincidir con el banco real; los dashboards convierten a USD
          usando la tasa del lanzamiento (para cobros) o la tasa mensual del
          proyecto (para gastos y movimientos).
        </div>
      </Field>

      <Field label="Saldo inicial" htmlFor="opening_balance">
        <input
          id="opening_balance"
          name="opening_balance"
          type="number"
          step="0.01"
          min="0"
          defaultValue={initial?.openingBalance ?? 0}
          placeholder="0"
          style={inputStyle}
        />
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginTop: 6 }}
        >
          Saldo del banco al empezar a usar el sistema, en la moneda nativa
          del banco. Después, cobros (vía métodos de pago) y movimientos
          manuales lo ajustan automáticamente. Cambiar este valor desplaza
          todos los saldos calculados hacia adelante.
        </div>
      </Field>

      <div>
        <label
          htmlFor="is_external_collector"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            cursor: "pointer",
          }}
        >
          <input
            id="is_external_collector"
            name="is_external_collector"
            type="checkbox"
            checked={isExternal}
            onChange={(e) => {
              const checked = e.target.checked;
              setIsExternal(checked);
              if (!checked) setExternalProjectId("");
            }}
            style={{ marginTop: 3 }}
          />
          <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span
              className="kg-t7"
              style={{ color: "var(--kg-text-1)", fontWeight: 600 }}
            >
              Es cobro externo (cliente cobra por su banco)
            </span>
            <span
              className="kg-t7"
              style={{ color: "var(--kg-text-3)" }}
            >
              Los cobros que rutan acá se registran como plata del cliente, no
              de Kingrow. Se excluyen del saldo y del cash flow.
            </span>
          </span>
        </label>
      </div>

      {isExternal && (
        <Field label="Proyecto (cliente externo)" htmlFor="external_project_id" required>
          <select
            id="external_project_id"
            name="external_project_id"
            required
            value={externalProjectId}
            onChange={(e) => setExternalProjectId(e.target.value)}
            style={inputStyle}
          >
            <option value="">— Elegí un proyecto —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-3)", marginTop: 6 }}
          >
            A qué cliente pertenece este canal de cobro.
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
