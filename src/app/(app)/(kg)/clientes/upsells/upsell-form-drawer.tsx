"use client";

import { useActionState, useEffect, useMemo, useState } from "react";

import { Drawer } from "@/components/kg/drawer";
import type { UpsellStatus } from "@/lib/clients/types";

import {
  createUpsell,
  updateUpsell,
  type CreateUpsellState,
  type UpdateUpsellState,
} from "./actions";

const STATUS_OPTIONS: ReadonlyArray<{ value: UpsellStatus; label: string }> = [
  { value: "propuesta", label: "Propuesta" },
  { value: "confirmada", label: "Confirmada" },
  { value: "facturada", label: "Facturada" },
  { value: "cobrada", label: "Cobrada" },
  { value: "perdida", label: "Perdida" },
];

export interface ClientOptionForUpsell {
  readonly id: string;
  readonly name: string;
}

export interface UpsellInitial {
  readonly id: string;
  readonly clientId: string;
  readonly title: string;
  readonly description: string | null;
  readonly category: string | null;
  readonly amount: number;
  readonly currency: "ARS" | "USD";
  readonly status: UpsellStatus;
  readonly closedAt: string | null;
  readonly lossReason: string | null;
  readonly notes: string | null;
}

export function UpsellFormDrawer({
  mode,
  open,
  onClose,
  clients,
  initial,
  presetClientId,
}: {
  readonly mode: "create" | "edit";
  readonly open: boolean;
  readonly onClose: () => void;
  readonly clients: readonly ClientOptionForUpsell[];
  readonly initial?: UpsellInitial;
  readonly presetClientId?: string | null;
}) {
  if (!open) return null;
  const title = mode === "create" ? "Nuevo upsell" : "Editar upsell";
  return (
    <Drawer open={open} onClose={onClose} title={title} width={560}>
      <UpsellFormBody
        mode={mode}
        clients={clients}
        initial={initial}
        presetClientId={presetClientId}
        onClose={onClose}
      />
    </Drawer>
  );
}

function UpsellFormBody({
  mode,
  clients,
  initial,
  presetClientId,
  onClose,
}: {
  readonly mode: "create" | "edit";
  readonly clients: readonly ClientOptionForUpsell[];
  readonly initial?: UpsellInitial;
  readonly presetClientId?: string | null;
  readonly onClose: () => void;
}) {
  const isEdit = mode === "edit" && initial != null;

  const updateBound = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id;
    return async (prev: UpdateUpsellState, fd: FormData) =>
      updateUpsell(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createFormAction, createPending] = useActionState<
    CreateUpsellState,
    FormData
  >(createUpsell, null);
  const [updateState, updateFormAction, updatePending] = useActionState<
    UpdateUpsellState,
    FormData
  >(
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

  const [status, setStatus] = useState<UpsellStatus>(
    initial?.status ?? "propuesta",
  );

  if (clients.length === 0) {
    return (
      <div style={{ padding: 8 }}>
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", lineHeight: 1.55 }}
        >
          No hay clientes activos cargados. Andá a{" "}
          <a
            href="/clientes"
            style={{ color: "var(--kg-accent-500)" }}
          >
            Clientes
          </a>{" "}
          para dar de alta al menos uno antes de registrar upsells.
        </div>
      </div>
    );
  }

  const initialClientId =
    initial?.clientId ?? presetClientId ?? clients[0]?.id ?? "";

  return (
    <form
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <Field label="Cliente" htmlFor="client_id" required>
        <select
          id="client_id"
          name="client_id"
          defaultValue={initialClientId}
          required
          style={inputStyle}
        >
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Título" htmlFor="title" required>
        <input
          id="title"
          name="title"
          type="text"
          required
          maxLength={300}
          defaultValue={initial?.title ?? ""}
          placeholder="Ej. Segundo launch 2026 · Módulo adicional de comunidad"
          style={inputStyle}
        />
      </Field>

      <Field label="Descripción" htmlFor="description">
        <textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={initial?.description ?? ""}
          placeholder="Alcance, entregables, condiciones"
          style={{ ...inputStyle, resize: "vertical", minHeight: 72 }}
        />
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr", gap: 12 }}>
        <Field label="Categoría" htmlFor="category">
          <input
            id="category"
            name="category"
            type="text"
            defaultValue={initial?.category ?? ""}
            placeholder="Ej. nuevo_launch"
            style={inputStyle}
          />
        </Field>
        <Field label="Monto (neto)" htmlFor="amount" required>
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
          </select>
        </Field>
      </div>

      <Field label="Estado" htmlFor="status" required>
        <select
          id="status"
          name="status"
          value={status}
          onChange={(e) => setStatus(e.target.value as UpsellStatus)}
          style={inputStyle}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      {status === "cobrada" && (
        <Field label="Fecha de cierre" htmlFor="closed_at">
          <input
            id="closed_at"
            name="closed_at"
            type="date"
            defaultValue={initial?.closedAt ?? ""}
            style={inputStyle}
          />
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-3)", marginTop: 6 }}
          >
            Si lo dejás vacío se guarda con la fecha de hoy.
          </div>
        </Field>
      )}

      {status === "perdida" && (
        <Field label="Motivo del churn" htmlFor="loss_reason">
          <textarea
            id="loss_reason"
            name="loss_reason"
            rows={2}
            defaultValue={initial?.lossReason ?? ""}
            placeholder="Ej. cliente no aprobó el alcance, prefirió otra propuesta"
            style={{ ...inputStyle, resize: "vertical", minHeight: 56 }}
          />
        </Field>
      )}

      <Field label="Notas" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={2}
          defaultValue={initial?.notes ?? ""}
          placeholder="Contexto libre"
          style={{ ...inputStyle, resize: "vertical", minHeight: 56 }}
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
            ? isEdit
              ? "Guardando…"
              : "Creando…"
            : isEdit
              ? "Guardar cambios"
              : "Crear upsell"}
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
  colorScheme: "dark",
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
