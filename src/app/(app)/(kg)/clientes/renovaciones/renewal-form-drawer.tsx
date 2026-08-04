"use client";

import { useActionState, useEffect, useMemo, useState } from "react";

import { Drawer } from "@/components/kg/drawer";
import type { RenewalStatus } from "@/lib/clients/types";

import {
  createRenewal,
  updateRenewal,
  type CreateRenewalState,
  type UpdateRenewalState,
} from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer para crear o editar una renewal.
//
// Los campos collected_at y loss_reason aparecen visualmente solo cuando
// aplica el status. El server también refuerza la regla — el CHECK del
// esquema no permite estados inconsistentes.
// ═══════════════════════════════════════════════════════════════════════════

const STATUS_OPTIONS: ReadonlyArray<{ value: RenewalStatus; label: string }> = [
  { value: "propuesta", label: "Propuesta" },
  { value: "confirmada", label: "Confirmada" },
  { value: "facturada", label: "Facturada" },
  { value: "cobrada", label: "Cobrada" },
  { value: "perdida", label: "Perdida" },
];

export interface ClientOptionForRenewal {
  readonly id: string;
  readonly name: string;
}

export interface RenewalInitial {
  readonly id: string;
  readonly clientId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly amount: number;
  readonly currency: "ARS" | "USD";
  readonly status: RenewalStatus;
  readonly collectedAt: string | null;
  readonly lossReason: string | null;
  readonly notes: string | null;
}

export function RenewalFormDrawer({
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
  readonly clients: readonly ClientOptionForRenewal[];
  readonly initial?: RenewalInitial;
  readonly presetClientId?: string | null;
}) {
  if (!open) return null;
  const title = mode === "create" ? "Nueva renewal" : "Editar renewal";
  return (
    <Drawer open={open} onClose={onClose} title={title} width={560}>
      <RenewalFormBody
        mode={mode}
        clients={clients}
        initial={initial}
        presetClientId={presetClientId}
        onClose={onClose}
      />
    </Drawer>
  );
}

function RenewalFormBody({
  mode,
  clients,
  initial,
  presetClientId,
  onClose,
}: {
  readonly mode: "create" | "edit";
  readonly clients: readonly ClientOptionForRenewal[];
  readonly initial?: RenewalInitial;
  readonly presetClientId?: string | null;
  readonly onClose: () => void;
}) {
  const isEdit = mode === "edit" && initial != null;

  const updateBound = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id;
    return async (prev: UpdateRenewalState, fd: FormData) =>
      updateRenewal(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createFormAction, createPending] = useActionState<
    CreateRenewalState,
    FormData
  >(createRenewal, null);
  const [updateState, updateFormAction, updatePending] = useActionState<
    UpdateRenewalState,
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

  const initialPeriod = useMemo(() => currentMonthBounds(), []);
  const [status, setStatus] = useState<RenewalStatus>(
    initial?.status ?? "propuesta",
  );
  const [periodStart, setPeriodStart] = useState(
    initial?.periodStart ?? initialPeriod.start,
  );
  const [periodEnd, setPeriodEnd] = useState(
    initial?.periodEnd ?? initialPeriod.end,
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
          para dar de alta al menos uno antes de registrar renewals.
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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Inicio del período" htmlFor="period_start" required>
          <input
            id="period_start"
            name="period_start"
            type="date"
            required
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Fin del período" htmlFor="period_end" required>
          <input
            id="period_end"
            name="period_end"
            type="date"
            required
            value={periodEnd}
            min={periodStart}
            onChange={(e) => setPeriodEnd(e.target.value)}
            style={inputStyle}
          />
        </Field>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
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
          onChange={(e) => setStatus(e.target.value as RenewalStatus)}
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
        <Field label="Fecha de cobro" htmlFor="collected_at">
          <input
            id="collected_at"
            name="collected_at"
            type="date"
            defaultValue={initial?.collectedAt ?? ""}
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
            placeholder="Ej. no renovó por costo, cambió de agencia, cerró el negocio"
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
          placeholder="Contexto libre — condiciones, descuentos, aclaraciones"
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
              : "Crear renewal"}
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

function currentMonthBounds(): { start: string; end: string } {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const last = new Date(y, m, 0).getDate();
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return { start, end };
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
