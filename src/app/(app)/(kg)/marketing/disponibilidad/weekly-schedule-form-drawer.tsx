"use client";

import { useActionState, useEffect, useState, useTransition } from "react";

import { Drawer } from "@/components/kg/drawer";
import { WEEKDAY_LABEL, WEEKDAYS, type Weekday } from "@/lib/marketing/types";

import {
  deleteWeeklyScheduleRow,
  updateWeeklyScheduleRow,
  upsertWeeklySchedule,
  type UpsertWeeklyScheduleState,
} from "./actions";

export interface PersonOption {
  readonly id: string;
  readonly fullName: string;
}

export interface WeeklyScheduleInitial {
  readonly id: string;
  readonly personId: string;
  readonly personName: string;
  readonly dayOfWeek: Weekday;
  readonly startTime: string;
  readonly endTime: string;
  readonly notes: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Drawer de horario semanal.
//
// Modo create: elegís persona + uno o varios días de la semana + UN horario
// — crea/pisa una fila por día seleccionado (upsert por person+day). Cubre
// el caso típico "lunes a viernes 9 a 14" sin repetir el formulario 5 veces.
//
// Modo edit: persona y día quedan fijos (cambiar el día es borrar + crear);
// se edita horario y notas de esa fila puntual.
// ═══════════════════════════════════════════════════════════════════════════

export function WeeklyScheduleFormDrawer({
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
  readonly initial?: WeeklyScheduleInitial;
}) {
  if (!open) return null;
  const title = mode === "create" ? "Nuevo horario semanal" : "Editar horario";
  return (
    <Drawer open={open} onClose={onClose} title={title} width={520}>
      {mode === "create" ? (
        <CreateBody onClose={onClose} personOptions={personOptions} />
      ) : (
        initial && <EditBody onClose={onClose} initial={initial} />
      )}
    </Drawer>
  );
}

function CreateBody({
  onClose,
  personOptions,
}: {
  readonly onClose: () => void;
  readonly personOptions: readonly PersonOption[];
}) {
  const [state, formAction, pending] = useActionState<
    UpsertWeeklyScheduleState,
    FormData
  >(upsertWeeklySchedule, null);

  useEffect(() => {
    if (state && "ok" in state && state.ok) onClose();
  }, [state, onClose]);

  const [selectedDays, setSelectedDays] = useState<Set<Weekday>>(
    new Set([1, 2, 3, 4, 5]),
  );

  function toggleDay(d: Weekday) {
    setSelectedDays((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }

  return (
    <form
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <Field label="Persona" htmlFor="person_id" required>
        <select id="person_id" name="person_id" required style={inputStyle}>
          <option value="">— Elegí una persona —</option>
          {personOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.fullName}
            </option>
          ))}
        </select>
      </Field>

      <div>
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginBottom: 6 }}
        >
          Días de la semana
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {WEEKDAYS.map((d) => {
            const checked = selectedDays.has(d);
            return (
              <label
                key={d}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 10px",
                  borderRadius: 999,
                  background: checked
                    ? "var(--kg-accent-halo)"
                    : "var(--kg-surface-2-solid)",
                  border: "1px solid var(--kg-border-subtle)",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                <input
                  type="checkbox"
                  name="day_of_week"
                  value={d}
                  checked={checked}
                  onChange={() => toggleDay(d)}
                  style={{ cursor: "pointer" }}
                />
                {WEEKDAY_LABEL[d]}
              </label>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <Field label="Desde" htmlFor="start_time" required>
            <input
              id="start_time"
              name="start_time"
              type="time"
              required
              defaultValue="09:00"
              style={inputStyle}
            />
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Hasta" htmlFor="end_time" required>
            <input
              id="end_time"
              name="end_time"
              type="time"
              required
              defaultValue="18:00"
              style={inputStyle}
            />
          </Field>
        </div>
      </div>

      <Field label="Notas" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={2}
          placeholder="Contexto libre — ej. horario reducido, remoto, etc."
          style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
        />
      </Field>

      {state && "error" in state && <ErrorBanner message={state.error} />}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
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
          {pending ? "Guardando…" : "Crear horario"}
        </button>
      </div>
    </form>
  );
}

function EditBody({
  onClose,
  initial,
}: {
  readonly onClose: () => void;
  readonly initial: WeeklyScheduleInitial;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [startTime, setStartTime] = useState(initial.startTime);
  const [endTime, setEndTime] = useState(initial.endTime);
  const [notes, setNotes] = useState(initial.notes ?? "");

  const [deletePending, startDeleteTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await updateWeeklyScheduleRow(
        initial.id,
        startTime,
        endTime,
        notes,
      );
      if ("error" in result) {
        setError(result.error);
        return;
      }
      onClose();
    });
  }

  function handleDelete() {
    const ok = window.confirm("¿Eliminar este horario?");
    if (!ok) return;
    setDeleteError(null);
    startDeleteTransition(async () => {
      const result = await deleteWeeklyScheduleRow(initial.id);
      if ("error" in result) {
        setDeleteError(result.error);
        return;
      }
      onClose();
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <div
        className="kg-t7"
        style={{
          padding: "10px 14px",
          borderRadius: "var(--kg-r-8)",
          background: "var(--kg-surface-2-solid)",
          border: "1px solid var(--kg-border-subtle)",
          color: "var(--kg-text-2)",
        }}
      >
        {initial.personName} · {WEEKDAY_LABEL[initial.dayOfWeek]}
      </div>

      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <Field label="Desde" htmlFor="edit_start_time" required>
            <input
              id="edit_start_time"
              type="time"
              required
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              style={inputStyle}
            />
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Hasta" htmlFor="edit_end_time" required>
            <input
              id="edit_end_time"
              type="time"
              required
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              style={inputStyle}
            />
          </Field>
        </div>
      </div>

      <Field label="Notas" htmlFor="edit_notes">
        <textarea
          id="edit_notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
        />
      </Field>

      {error && <ErrorBanner message={error} />}
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
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending || deletePending}
          className="kg-focus"
          style={{ ...dangerBtn, opacity: deletePending ? 0.7 : 1 }}
        >
          {deletePending ? "Eliminando…" : "Eliminar"}
        </button>
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
            {pending ? "Guardando…" : "Guardar cambios"}
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
