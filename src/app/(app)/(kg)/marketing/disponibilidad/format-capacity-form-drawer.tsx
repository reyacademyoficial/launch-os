"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";

import { Drawer } from "@/components/kg/drawer";
import {
  FORMAT_LABEL,
  MARKETING_FORMATS,
  type MarketingFormat,
} from "@/lib/marketing/types";

import {
  deleteFormatCapacity,
  updateFormatCapacity,
  upsertFormatCapacity,
  type UpsertFormatCapacityState,
} from "./actions";

export interface PersonOption {
  readonly id: string;
  readonly fullName: string;
}

export interface FormatCapacityInitial {
  readonly id: string;
  readonly personId: string;
  readonly personName: string;
  readonly format: MarketingFormat;
  readonly maxPerDay: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Drawer de capacidad máxima por formato (persona × formato → max_per_day).
//
// Modo create: `upsertFormatCapacity` — persona + formato editables.
// Modo edit: `updateFormatCapacity` — persona y formato TAMBIÉN son
// editables; la fila se identifica por su `id` (capturado en `initial`), no
// por lo que el usuario tipee.
// ═══════════════════════════════════════════════════════════════════════════

export function FormatCapacityFormDrawer({
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
  readonly initial?: FormatCapacityInitial;
}) {
  if (!open) return null;
  const title = mode === "create" ? "Nueva capacidad" : "Editar capacidad";
  return (
    <Drawer open={open} onClose={onClose} title={title} width={480}>
      <FormBody mode={mode} onClose={onClose} personOptions={personOptions} initial={initial} />
    </Drawer>
  );
}

function FormBody({
  mode,
  onClose,
  personOptions,
  initial,
}: {
  readonly mode: "create" | "edit";
  readonly onClose: () => void;
  readonly personOptions: readonly PersonOption[];
  readonly initial?: FormatCapacityInitial;
}) {
  const isEdit = mode === "edit" && initial != null;

  const updateBound = useMemo(() => {
    if (!isEdit || !initial) return null;
    const id = initial.id;
    return async (prev: UpsertFormatCapacityState, fd: FormData) =>
      updateFormatCapacity(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createFormAction, createPending] = useActionState<
    UpsertFormatCapacityState,
    FormData
  >(upsertFormatCapacity, null);
  const [updateState, updateFormAction, updatePending] = useActionState<
    UpsertFormatCapacityState,
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
    const ok = window.confirm("¿Eliminar esta capacidad?");
    if (!ok) return;
    setDeleteError(null);
    startDeleteTransition(async () => {
      const result = await deleteFormatCapacity(initial.id);
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

      <Field label="Formato" htmlFor="format" required>
        <select
          id="format"
          name="format"
          required
          defaultValue={initial?.format ?? ""}
          style={inputStyle}
        >
          <option value="">— Elegí —</option>
          {MARKETING_FORMATS.map((f) => (
            <option key={f} value={f}>
              {FORMAT_LABEL[f]}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Máximo por día"
        htmlFor="max_per_day"
        required
        hint="Si esta persona sólo hiciera este formato todo el día, cuántos entrarían. Ej: 6 reels, 10 nuggets, 1 podcast."
      >
        <input
          id="max_per_day"
          name="max_per_day"
          type="number"
          min={1}
          max={200}
          required
          defaultValue={initial?.maxPerDay ?? ""}
          style={inputStyle}
        />
      </Field>

      {state && "error" in state && <ErrorBanner message={state.error} />}
      {deleteError && <ErrorBanner message={deleteError} />}

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
            {pending ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear capacidad"}
          </button>
        </div>
      </div>
    </form>
  );
}

function ErrorBanner({ message }: { readonly message: string }) {
  return (
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
      {message}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  required,
  hint,
  children,
}: {
  readonly label: string;
  readonly htmlFor: string;
  readonly required?: boolean;
  readonly hint?: string;
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
      {hint && (
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginTop: 4 }}
        >
          {hint}
        </div>
      )}
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
