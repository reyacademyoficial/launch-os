"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";

import { Drawer } from "@/components/kg/drawer";

import {
  createProject,
  deleteProject,
  updateProject,
  type CreateProjectState,
  type UpdateProjectState,
} from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer para crear o editar un internal_project.
//
// El status controla implícitamente closed_at (manejado server-side).
// El owner es opcional (proyecto sin dueño OK — el owner se asigna después).
// ═══════════════════════════════════════════════════════════════════════════

type Status = "backlog" | "active" | "paused" | "done" | "archived";
type Priority = "low" | "med" | "high" | "urgent";

const STATUS_OPTIONS: ReadonlyArray<{ value: Status; label: string }> = [
  { value: "backlog", label: "Backlog" },
  { value: "active", label: "Activo" },
  { value: "paused", label: "En pausa" },
  { value: "done", label: "Hecho" },
  { value: "archived", label: "Archivado" },
];

const PRIORITY_OPTIONS: ReadonlyArray<{ value: Priority; label: string }> = [
  { value: "low", label: "Baja" },
  { value: "med", label: "Media" },
  { value: "high", label: "Alta" },
  { value: "urgent", label: "Urgente" },
];

export interface OwnerOption {
  readonly id: string;
  readonly fullName: string;
}

export interface ProjectInitial {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: Status;
  readonly priority: Priority;
  readonly ownerId: string | null;
  readonly startsOn: string | null;
  readonly dueOn: string | null;
  readonly notes: string | null;
  /** Si viene de Notion (0132), pintamos un warning arriba del form. */
  readonly notionPageId?: string | null;
}

export function InternalProjectFormDrawer({
  mode,
  open,
  onClose,
  owners,
  initial,
}: {
  readonly mode: "create" | "edit";
  readonly open: boolean;
  readonly onClose: () => void;
  readonly owners: readonly OwnerOption[];
  readonly initial?: ProjectInitial;
}) {
  if (!open) return null;
  const title =
    mode === "create" ? "Nuevo proyecto interno" : "Editar proyecto";
  return (
    <Drawer open={open} onClose={onClose} title={title} width={560}>
      <ProjectFormBody
        mode={mode}
        owners={owners}
        initial={initial}
        onClose={onClose}
      />
    </Drawer>
  );
}

function ProjectFormBody({
  mode,
  owners,
  initial,
  onClose,
}: {
  readonly mode: "create" | "edit";
  readonly owners: readonly OwnerOption[];
  readonly initial?: ProjectInitial;
  readonly onClose: () => void;
}) {
  const isEdit = mode === "edit" && initial != null;

  const updateBound = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id;
    return async (prev: UpdateProjectState, fd: FormData) =>
      updateProject(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createFormAction, createPending] = useActionState<
    CreateProjectState,
    FormData
  >(createProject, null);
  const [updateState, updateFormAction, updatePending] = useActionState<
    UpdateProjectState,
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
    const ok = window.confirm(
      `¿Eliminar el proyecto "${initial.name}"? ` +
        "Esta acción no se puede deshacer. Si tiene tareas o registros de tiempo colgados va a rebotar — usá Archivar en su lugar.",
    );
    if (!ok) return;
    setDeleteError(null);
    startDeleteTransition(async () => {
      const result = await deleteProject(initial.id);
      if ("error" in result) {
        setDeleteError(result.error);
        return;
      }
      onClose();
    });
  }

  const isNotionSynced = isEdit && !!initial?.notionPageId;

  return (
    <form
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      {isNotionSynced && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: "var(--kg-r-8)",
            background: "rgba(255,184,0,0.10)",
            border: "1px solid #FFB800",
            color: "#FFB800",
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          <strong>Este proyecto se sincroniza desde Notion.</strong> Los
          cambios que hagas acá van a ser sobreescritos en el próximo sync.
          Editá el page en Notion para que persistan.
        </div>
      )}

      <Field label="Nombre" htmlFor="name" required>
        <input
          id="name"
          name="name"
          type="text"
          required
          maxLength={200}
          defaultValue={initial?.name ?? ""}
          placeholder="Ej. Rediseño web del portal cliente"
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
          placeholder="Alcance, objetivo, contexto libre"
          style={{ ...inputStyle, resize: "vertical", minHeight: 72 }}
        />
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Estado" htmlFor="status" required>
          <select
            id="status"
            name="status"
            defaultValue={initial?.status ?? "backlog"}
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
            defaultValue={initial?.priority ?? "med"}
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

      <Field label="Owner" htmlFor="owner_id">
        <select
          id="owner_id"
          name="owner_id"
          defaultValue={initial?.ownerId ?? ""}
          style={inputStyle}
        >
          <option value="">— Sin dueño —</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.fullName}
            </option>
          ))}
        </select>
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginTop: 6 }}
        >
          Persona responsable del proyecto interno. Se muestra en el listado y
          alimenta reportes de carga.
        </div>
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Inicio" htmlFor="starts_on">
          <input
            id="starts_on"
            name="starts_on"
            type="date"
            defaultValue={initial?.startsOn ?? ""}
            style={inputStyle}
          />
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
      </div>

      <Field label="Notas" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={2}
          defaultValue={initial?.notes ?? ""}
          placeholder="Cualquier contexto útil"
          style={{ ...inputStyle, resize: "vertical", minHeight: 56 }}
        />
      </Field>

      {state && "error" in state && <ErrorBanner text={state.error} />}
      {deleteError && <ErrorBanner text={deleteError} />}

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
            title="Elimina el proyecto (solo si no tiene tareas ni tiempo)"
          >
            {deletePending ? "Eliminando…" : "Eliminar proyecto"}
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
                : "Crear proyecto"}
          </button>
        </div>
      </div>
    </form>
  );
}

function ErrorBanner({ text }: { readonly text: string }) {
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
      {text}
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
