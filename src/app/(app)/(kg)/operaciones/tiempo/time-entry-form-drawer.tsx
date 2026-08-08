"use client";

import { useActionState, useEffect, useMemo, useState } from "react";

import { Drawer } from "@/components/kg/drawer";

import {
  createTimeEntry,
  updateTimeEntry,
  type CreateTimeEntryState,
  type UpdateTimeEntryState,
} from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer para crear o editar un time_entry.
//
// El operador tipea horas (más natural que minutos crudos). El formulario
// convierte a minutos antes de enviar via un hidden. Acepta decimales
// (ej. 1.5 = 90 min).
// ═══════════════════════════════════════════════════════════════════════════

export interface PersonOptionForTimeEntry {
  readonly id: string;
  readonly fullName: string;
  readonly active: boolean;
}

export interface TaskOptionForTimeEntry {
  readonly id: string;
  readonly title: string;
}

export interface ProjectOptionForTimeEntry {
  readonly id: string;
  readonly name: string;
}

export interface TimeEntryInitial {
  readonly id: string;
  readonly personId: string;
  readonly minutes: number;
  readonly loggedOn: string;
  readonly taskId: string | null;
  readonly internalProjectId: string | null;
  readonly notes: string | null;
}

export function TimeEntryFormDrawer({
  mode,
  open,
  onClose,
  people,
  tasks,
  projects,
  initial,
  presetPersonId,
  presetProjectId,
  presetTaskId,
}: {
  readonly mode: "create" | "edit";
  readonly open: boolean;
  readonly onClose: () => void;
  readonly people: readonly PersonOptionForTimeEntry[];
  readonly tasks: readonly TaskOptionForTimeEntry[];
  readonly projects: readonly ProjectOptionForTimeEntry[];
  readonly initial?: TimeEntryInitial;
  readonly presetPersonId?: string | null;
  readonly presetProjectId?: string | null;
  readonly presetTaskId?: string | null;
}) {
  if (!open) return null;
  const title = mode === "create" ? "Cargar tiempo" : "Editar registro";
  return (
    <Drawer open={open} onClose={onClose} title={title} width={520}>
      <TimeEntryFormBody
        mode={mode}
        people={people}
        tasks={tasks}
        projects={projects}
        initial={initial}
        presetPersonId={presetPersonId}
        presetProjectId={presetProjectId}
        presetTaskId={presetTaskId}
        onClose={onClose}
      />
    </Drawer>
  );
}

function TimeEntryFormBody({
  mode,
  people,
  tasks,
  projects,
  initial,
  presetPersonId,
  presetProjectId,
  presetTaskId,
  onClose,
}: {
  readonly mode: "create" | "edit";
  readonly people: readonly PersonOptionForTimeEntry[];
  readonly tasks: readonly TaskOptionForTimeEntry[];
  readonly projects: readonly ProjectOptionForTimeEntry[];
  readonly initial?: TimeEntryInitial;
  readonly presetPersonId?: string | null;
  readonly presetProjectId?: string | null;
  readonly presetTaskId?: string | null;
  readonly onClose: () => void;
}) {
  const isEdit = mode === "edit" && initial != null;

  const updateBound = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id;
    return async (prev: UpdateTimeEntryState, fd: FormData) =>
      updateTimeEntry(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createFormAction, createPending] = useActionState<
    CreateTimeEntryState,
    FormData
  >(createTimeEntry, null);
  const [updateState, updateFormAction, updatePending] = useActionState<
    UpdateTimeEntryState,
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

  const initialHours = initial != null ? initial.minutes / 60 : "";
  const [hours, setHours] = useState<string>(String(initialHours));

  const minutesForServer = (() => {
    const h = Number(hours);
    if (!Number.isFinite(h) || h <= 0) return 0;
    return Math.round(h * 60);
  })();

  const activePeople = people.filter((p) => p.active);
  // Personas inactivas se incluyen en edit (para poder mantener el
  // asiento sobre alguien que se dio de baja después). En create, solo
  // activas.
  const peopleForCurrentMode = isEdit ? people : activePeople;

  if (peopleForCurrentMode.length === 0) {
    return (
      <div style={{ padding: 8 }}>
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", lineHeight: 1.55 }}
        >
          No hay personas activas cargadas. Andá a{" "}
          <a
            href="/organizacion/personas"
            style={{ color: "var(--kg-accent-500)" }}
          >
            Organización → Personas
          </a>{" "}
          para dar de alta al menos una.
        </div>
      </div>
    );
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
          defaultValue={
            initial?.personId ?? presetPersonId ?? peopleForCurrentMode[0]?.id ?? ""
          }
          required
          style={inputStyle}
        >
          {peopleForCurrentMode.map((p) => (
            <option key={p.id} value={p.id}>
              {p.fullName}
              {p.active ? "" : " (inactiva)"}
            </option>
          ))}
        </select>
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Horas" htmlFor="__hours" required>
          <input
            id="__hours"
            type="number"
            step="0.25"
            min="0.1"
            required
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="Ej. 1.5"
            style={inputStyle}
            autoFocus
          />
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-3)", marginTop: 6 }}
          >
            {minutesForServer > 0
              ? `${minutesForServer} minutos totales`
              : "Ingresá horas (acepta decimales — 1.5 = 90 min)"}
          </div>
        </Field>
        <Field label="Fecha" htmlFor="logged_on" required>
          <input
            id="logged_on"
            name="logged_on"
            type="date"
            defaultValue={initial?.loggedOn ?? todayYmd()}
            required
            style={inputStyle}
          />
        </Field>
      </div>

      {/* Hidden con minutos calculados — el server valida > 0 y round. */}
      <input type="hidden" name="minutes" value={minutesForServer} />

      <Field label="Proyecto interno (opcional)" htmlFor="internal_project_id">
        <select
          id="internal_project_id"
          name="internal_project_id"
          defaultValue={
            initial?.internalProjectId ?? presetProjectId ?? ""
          }
          style={inputStyle}
        >
          <option value="">— Sin proyecto —</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Tarea (opcional)" htmlFor="task_id">
        <select
          id="task_id"
          name="task_id"
          defaultValue={initial?.taskId ?? presetTaskId ?? ""}
          style={inputStyle}
        >
          <option value="">— Sin tarea —</option>
          {tasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginTop: 6 }}
        >
          Proyecto y tarea son independientes. Podés dejar los dos vacíos
          (hora general), poner uno, o los dos (tarea dentro de un proyecto).
        </div>
      </Field>

      <Field label="Notas" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={2}
          defaultValue={initial?.notes ?? ""}
          placeholder="Qué hiciste en esas horas"
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
          disabled={pending || minutesForServer <= 0}
          className="kg-focus"
          style={{
            ...primaryBtn,
            opacity: pending || minutesForServer <= 0 ? 0.7 : 1,
          }}
        >
          {pending
            ? isEdit
              ? "Guardando…"
              : "Cargando…"
            : isEdit
              ? "Guardar cambios"
              : "Cargar tiempo"}
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

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
