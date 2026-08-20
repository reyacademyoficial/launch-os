"use client";

import { useActionState, useEffect, useMemo, useState } from "react";

import { Drawer } from "@/components/kg/drawer";

import {
  createTask,
  updateTask,
  type CreateTaskState,
  type UpdateTaskState,
} from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer para crear o editar una tarea.
//
// Todos los campos son opcionales salvo title, status y priority. El
// proyecto y el assignee son OPCIONALES: una tarea suelta sin proyecto y
// sin dueño es válida (ad-hoc, "revisar factura pendiente").
// ═══════════════════════════════════════════════════════════════════════════

type Status =
  | "sin_empezar"
  | "en_proceso"
  | "bloqueado"
  | "alerta_maxima"
  | "listo";
type Priority = "alta" | "media" | "baja";

const STATUS_OPTIONS: ReadonlyArray<{ value: Status; label: string }> = [
  { value: "sin_empezar", label: "Sin empezar" },
  { value: "en_proceso", label: "En proceso" },
  { value: "bloqueado", label: "Bloqueada" },
  { value: "alerta_maxima", label: "Alerta máxima" },
  { value: "listo", label: "Listo" },
];

const PRIORITY_OPTIONS: ReadonlyArray<{ value: Priority; label: string }> = [
  { value: "alta", label: "Alta" },
  { value: "media", label: "Media" },
  { value: "baja", label: "Baja" },
];

export interface ProjectOptionForTask {
  readonly id: string;
  readonly name: string;
}

export interface AssigneeOptionForTask {
  readonly id: string;
  readonly fullName: string;
}

export interface TaskInitial {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: Status;
  readonly priority: Priority;
  readonly internalProjectId: string | null;
  readonly assigneeId: string | null;
  readonly dueOn: string | null;
  readonly completedAt: string | null;
  readonly isRecurring: boolean;
  /** 0=domingo … 6=sábado */
  readonly recurrenceDays: readonly number[] | null;
  readonly estimatedMinutes: number | null;
  /** Total histórico de días completados. */
  readonly completionsCount: number;
  /** Últimas 3 fechas completadas (YYYY-MM-DD), más reciente primero. */
  readonly recentCompletions: readonly string[];
}

// L=lunes … D=domingo. `value` = Date.getDay() (0=dom).
const WEEKDAY_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: "L" },
  { value: 2, label: "M" },
  { value: 3, label: "X" },
  { value: 4, label: "J" },
  { value: 5, label: "V" },
  { value: 6, label: "S" },
  { value: 0, label: "D" },
];

export function TaskFormDrawer({
  mode,
  open,
  onClose,
  projects,
  assignees,
  initial,
  presetProjectId,
  presetAssigneeId,
}: {
  readonly mode: "create" | "edit";
  readonly open: boolean;
  readonly onClose: () => void;
  readonly projects: readonly ProjectOptionForTask[];
  readonly assignees: readonly AssigneeOptionForTask[];
  readonly initial?: TaskInitial;
  /** Proyecto pre-seleccionado en create (viene de la ficha del proyecto). */
  readonly presetProjectId?: string | null;
  /** Assignee pre-seleccionado en create (útil para "crear tarea para mí"). */
  readonly presetAssigneeId?: string | null;
}) {
  if (!open) return null;
  const title = mode === "create" ? "Nueva tarea" : "Editar tarea";
  return (
    <Drawer open={open} onClose={onClose} title={title} width={560}>
      <TaskFormBody
        mode={mode}
        projects={projects}
        assignees={assignees}
        initial={initial}
        presetProjectId={presetProjectId}
        presetAssigneeId={presetAssigneeId}
        onClose={onClose}
      />
    </Drawer>
  );
}

function TaskFormBody({
  mode,
  projects,
  assignees,
  initial,
  presetProjectId,
  presetAssigneeId,
  onClose,
}: {
  readonly mode: "create" | "edit";
  readonly projects: readonly ProjectOptionForTask[];
  readonly assignees: readonly AssigneeOptionForTask[];
  readonly initial?: TaskInitial;
  readonly presetProjectId?: string | null;
  readonly presetAssigneeId?: string | null;
  readonly onClose: () => void;
}) {
  const isEdit = mode === "edit" && initial != null;

  const updateBound = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id;
    return async (prev: UpdateTaskState, fd: FormData) =>
      updateTask(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createFormAction, createPending] = useActionState<
    CreateTaskState,
    FormData
  >(createTask, null);
  const [updateState, updateFormAction, updatePending] = useActionState<
    UpdateTaskState,
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

  const [status, setStatus] = useState<Status>(initial?.status ?? "sin_empezar");
  const [isRecurring, setIsRecurring] = useState<boolean>(
    initial?.isRecurring ?? false,
  );
  const initialDays = useMemo(
    () => new Set<number>(initial?.recurrenceDays ?? []),
    [initial?.recurrenceDays],
  );
  const [recurrenceDays, setRecurrenceDays] = useState<Set<number>>(initialDays);

  function toggleDay(day: number) {
    setRecurrenceDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  return (
    <form
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <Field label="Título" htmlFor="title" required>
        <input
          id="title"
          name="title"
          type="text"
          required
          maxLength={300}
          defaultValue={initial?.title ?? ""}
          placeholder="Ej. Revisar propuesta del cliente X"
          style={inputStyle}
          autoFocus
        />
      </Field>

      <Field label="Descripción" htmlFor="description">
        <textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={initial?.description ?? ""}
          placeholder="Contexto libre — qué hay que hacer y por qué"
          style={{ ...inputStyle, resize: "vertical", minHeight: 72 }}
        />
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Estado" htmlFor="status" required>
          <select
            id="status"
            name="status"
            value={status}
            onChange={(e) => setStatus(e.target.value as Status)}
            style={inputStyle}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Prioridad" htmlFor="priority" required>
          <select
            id="priority"
            name="priority"
            defaultValue={initial?.priority ?? "media"}
            style={inputStyle}
          >
            {PRIORITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Proyecto interno (opcional)" htmlFor="internal_project_id">
        <select
          id="internal_project_id"
          name="internal_project_id"
          defaultValue={
            initial?.internalProjectId ?? presetProjectId ?? ""
          }
          style={inputStyle}
        >
          <option value="">— Tarea suelta (sin proyecto) —</option>
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
          Una tarea puede vivir suelta (ad-hoc) o colgar de un proyecto
          interno. Los proyectos archivados no aparecen.
        </div>
      </Field>

      <Field label="Asignada a" htmlFor="assignee_id">
        <select
          id="assignee_id"
          name="assignee_id"
          defaultValue={initial?.assigneeId ?? presetAssigneeId ?? ""}
          style={inputStyle}
        >
          <option value="">— Sin asignar —</option>
          {assignees.map((a) => (
            <option key={a.id} value={a.id}>
              {a.fullName}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Vencimiento" htmlFor="due_on">
        <input
          id="due_on"
          name="due_on"
          type="date"
          defaultValue={initial?.dueOn ?? ""}
          style={inputStyle}
        />
      </Field>

      {/* ─── Recurrencia diaria ────────────────────────────────────────────── */}
      <div
        style={{
          padding: "12px 14px",
          borderRadius: "var(--kg-r-8)",
          background: "var(--kg-surface-2-solid)",
          border: "1px solid var(--kg-border-subtle)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <label
          htmlFor="is_recurring"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            cursor: "pointer",
            color: "var(--kg-text-1)",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <input
            id="is_recurring"
            name="is_recurring"
            type="checkbox"
            checked={isRecurring}
            onChange={(e) => setIsRecurring(e.target.checked)}
          />
          Tarea diaria
        </label>
        <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
          Se marca como hecha día por día. Al apagarla se preserva el
          historial. Si tiene duración estimada, se suma a la carga diaria de
          la persona asignada.
        </div>

        {isRecurring && (
          <>
            <Field label="Días de la semana" htmlFor="recurrence_days_grp" required>
              <div
                id="recurrence_days_grp"
                role="group"
                aria-label="Días de la semana"
                style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
              >
                {WEEKDAY_OPTIONS.map((d) => {
                  const active = recurrenceDays.has(d.value);
                  return (
                    <label
                      key={d.value}
                      title={weekdayFullLabel(d.value)}
                      style={{
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        minWidth: 34,
                        height: 34,
                        borderRadius: 999,
                        border: active
                          ? "1px solid var(--kg-accent-500)"
                          : "1px solid var(--kg-border-subtle)",
                        background: active
                          ? "var(--kg-accent-500)"
                          : "transparent",
                        color: active ? "#fff" : "var(--kg-text-2)",
                        fontSize: 12,
                        fontWeight: 700,
                        userSelect: "none",
                      }}
                    >
                      <input
                        type="checkbox"
                        name="recurrence_days"
                        value={d.value}
                        checked={active}
                        onChange={() => toggleDay(d.value)}
                        style={{
                          position: "absolute",
                          opacity: 0,
                          pointerEvents: "none",
                        }}
                      />
                      {d.label}
                    </label>
                  );
                })}
              </div>
            </Field>

            <Field label="Duración estimada (minutos)" htmlFor="estimated_minutes">
              <input
                id="estimated_minutes"
                name="estimated_minutes"
                type="number"
                min={1}
                max={1440}
                step={1}
                defaultValue={initial?.estimatedMinutes ?? ""}
                placeholder="Ej. 30"
                style={inputStyle}
              />
            </Field>
          </>
        )}

        {isEdit && initial && initial.completionsCount > 0 && (
          <div
            style={{
              paddingTop: 10,
              borderTop: "1px dashed var(--kg-border-subtle)",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div
              className="kg-t7"
              style={{ color: "var(--kg-text-2)", fontWeight: 600 }}
            >
              Historial · {initial.completionsCount}{" "}
              {initial.completionsCount === 1 ? "vez" : "veces"}
            </div>
            <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
              {initial.recentCompletions.length > 0
                ? `Últimas: ${initial.recentCompletions
                    .map((d) => formatYmdShort(d))
                    .join(" · ")}`
                : "—"}
            </div>
          </div>
        )}
      </div>

      {isEdit && initial?.completedAt && (
        <div
          className="kg-t7"
          style={{
            color: "var(--kg-text-3)",
            padding: "8px 12px",
            borderRadius: "var(--kg-r-8)",
            background: "var(--kg-surface-2-solid)",
            border: "1px solid var(--kg-border-subtle)",
          }}
        >
          Cerrada el {formatIso(initial.completedAt)}. Si volvés a un estado
          abierto, se resetea; si guardás con estado cerrado, se preserva.
        </div>
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
            ? isEdit
              ? "Guardando…"
              : "Creando…"
            : isEdit
              ? "Guardar cambios"
              : "Crear tarea"}
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

function formatIso(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function formatYmdShort(ymd: string): string {
  try {
    return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "short",
    });
  } catch {
    return ymd.slice(0, 10);
  }
}

function weekdayFullLabel(day: number): string {
  const labels = [
    "Domingo",
    "Lunes",
    "Martes",
    "Miércoles",
    "Jueves",
    "Viernes",
    "Sábado",
  ];
  return labels[day] ?? "";
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
