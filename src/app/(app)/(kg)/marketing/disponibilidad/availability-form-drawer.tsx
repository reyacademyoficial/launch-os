"use client";

import { useActionState, useEffect, useMemo, useTransition, useState } from "react";

import { Drawer } from "@/components/kg/drawer";

import {
  createAvailability,
  deleteAvailability,
  updateAvailability,
  type CreateAvailabilityState,
  type UpdateAvailabilityState,
} from "./actions";

export interface PersonOption {
  readonly id: string;
  readonly fullName: string;
}

export interface AvailabilityInitial {
  readonly id: string;
  readonly personId: string;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly available: boolean;
  readonly notes: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Drawer create/edit de editor_availability.
// Modelo simple — 1 persona + rango + flag available/no.
// ═══════════════════════════════════════════════════════════════════════════

export function AvailabilityFormDrawer({
  mode,
  open,
  onClose,
  personOptions,
  initial,
}: {
  readonly mode: "create" | "edit";
  readonly open: boolean;
  readonly onClose: () => void;
  readonly personOptions: readonly PersonOption[];
  readonly initial?: AvailabilityInitial;
}) {
  if (!open) return null;
  const title = mode === "create" ? "Nuevo bloque de disponibilidad" : "Editar bloque";
  return (
    <Drawer open={open} onClose={onClose} title={title} width={520}>
      <AvailabilityFormBody
        mode={mode}
        onClose={onClose}
        personOptions={personOptions}
        initial={initial}
      />
    </Drawer>
  );
}

function AvailabilityFormBody({
  mode,
  onClose,
  personOptions,
  initial,
}: {
  readonly mode: "create" | "edit";
  readonly onClose: () => void;
  readonly personOptions: readonly PersonOption[];
  readonly initial?: AvailabilityInitial;
}) {
  const isEdit = mode === "edit" && initial != null;

  const updateBound = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id;
    return async (prev: UpdateAvailabilityState, fd: FormData) =>
      updateAvailability(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createFormAction, createPending] = useActionState<
    CreateAvailabilityState,
    FormData
  >(createAvailability, null);
  const [updateState, updateFormAction, updatePending] = useActionState<
    UpdateAvailabilityState,
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

  const [deletePending, startDeleteTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function handleDelete() {
    if (!isEdit || !initial) return;
    const ok = window.confirm("¿Eliminar este bloque?");
    if (!ok) return;
    setDeleteError(null);
    startDeleteTransition(async () => {
      const result = await deleteAvailability(initial.id);
      if ("error" in result) {
        setDeleteError(result.error);
        return;
      }
      onClose();
    });
  }

  return (
    <form
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <Field label="Persona" htmlFor="person_id" required>
        <select
          id="person_id"
          name="person_id"
          required
          defaultValue={initial?.personId ?? ""}
          style={inputStyle}
        >
          <option value="">— Elegí una persona —</option>
          {personOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.fullName}
            </option>
          ))}
        </select>
      </Field>

      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <Field label="Desde" htmlFor="date_from" required>
            <input
              id="date_from"
              name="date_from"
              type="date"
              required
              defaultValue={initial?.dateFrom ?? ""}
              style={inputStyle}
            />
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Hasta" htmlFor="date_to" required>
            <input
              id="date_to"
              name="date_to"
              type="date"
              required
              defaultValue={initial?.dateTo ?? ""}
              style={inputStyle}
            />
          </Field>
        </div>
      </div>

      <Field label="Tipo de bloque" htmlFor="available" required>
        <select
          id="available"
          name="available"
          required
          defaultValue={initial?.available === false ? "false" : "true"}
          style={inputStyle}
        >
          <option value="true">Disponible</option>
          <option value="false">No disponible (licencia / ausencia)</option>
        </select>
      </Field>

      <Field label="Notas" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={2}
          defaultValue={initial?.notes ?? ""}
          placeholder="Contexto — ej. vacaciones, PTO, half-day, etc."
          style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
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

      {deleteError && (
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
          {deleteError}
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          marginTop: 4,
        }}
      >
        {isEdit ? (
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending || deletePending}
            className="kg-focus"
            style={{ ...dangerBtn, opacity: deletePending ? 0.7 : 1 }}
          >
            {deletePending ? "Eliminando…" : "Eliminar"}
          </button>
        ) : (
          <div />
        )}
        <div style={{ display: "flex", gap: 8 }}>
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
              ? isEdit
                ? "Guardando…"
                : "Creando…"
              : isEdit
                ? "Guardar cambios"
                : "Crear bloque"}
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

const dangerBtn: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid #EF4444",
  color: "#EF4444",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
};
