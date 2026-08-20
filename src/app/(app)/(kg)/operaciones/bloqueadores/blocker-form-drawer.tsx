"use client";

import { useActionState, useEffect, useMemo, useState } from "react";

import { Drawer } from "@/components/kg/drawer";

import {
  createBlocker,
  updateBlocker,
  type CreateBlockerState,
  type UpdateBlockerState,
} from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer para crear o editar un bloqueador.
//
// XOR duro entre task_id / internal_project_id: el operador elige tipo de
// parent (Tarea | Proyecto) con radios, y el dropdown de parent_id refleja
// la lista correspondiente. El name del select es siempre "parent_id"; el
// action recompone el par correcto según parent_kind.
//
// Resolución: los campos resolved_at + resolved_by aparecen solo cuando el
// operador marca el checkbox "Marcado como resuelto". Si desmarca, ambos
// se limpian. El invariante del CHECK (resolved_by requires resolved_at)
// queda garantizado.
// ═══════════════════════════════════════════════════════════════════════════

export interface TaskOptionForBlocker {
  readonly id: string;
  readonly title: string;
  readonly projectName: string | null;
}

export interface ProjectOptionForBlocker {
  readonly id: string;
  readonly name: string;
}

export interface PersonOptionForBlocker {
  readonly id: string;
  readonly fullName: string;
}

export interface BlockerInitial {
  readonly id: string;
  readonly parentKind: "task" | "project";
  readonly parentId: string;
  readonly reason: string;
  readonly resolvedAt: string | null;
  readonly resolvedBy: string | null;
}

export function BlockerFormDrawer({
  mode,
  open,
  onClose,
  tasks,
  projects,
  people,
  initial,
  presetParentKind,
  presetParentId,
}: {
  readonly mode: "create" | "edit";
  readonly open: boolean;
  readonly onClose: () => void;
  readonly tasks: readonly TaskOptionForBlocker[];
  readonly projects: readonly ProjectOptionForBlocker[];
  readonly people: readonly PersonOptionForBlocker[];
  readonly initial?: BlockerInitial;
  /** Solo aplica en create — presetea la selección de parent al abrir. */
  readonly presetParentKind?: "task" | "project";
  readonly presetParentId?: string;
}) {
  if (!open) return null;
  const title = mode === "create" ? "Nuevo bloqueador" : "Editar bloqueador";
  return (
    <Drawer open={open} onClose={onClose} title={title} width={560}>
      <BlockerFormBody
        mode={mode}
        tasks={tasks}
        projects={projects}
        people={people}
        initial={initial}
        presetParentKind={presetParentKind}
        presetParentId={presetParentId}
        onClose={onClose}
      />
    </Drawer>
  );
}

function BlockerFormBody({
  mode,
  tasks,
  projects,
  people,
  initial,
  presetParentKind,
  presetParentId,
  onClose,
}: {
  readonly mode: "create" | "edit";
  readonly tasks: readonly TaskOptionForBlocker[];
  readonly projects: readonly ProjectOptionForBlocker[];
  readonly people: readonly PersonOptionForBlocker[];
  readonly initial?: BlockerInitial;
  readonly presetParentKind?: "task" | "project";
  readonly presetParentId?: string;
  readonly onClose: () => void;
}) {
  const isEdit = mode === "edit" && initial != null;

  const updateBound = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id;
    return async (prev: UpdateBlockerState, fd: FormData) =>
      updateBlocker(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createFormAction, createPending] = useActionState<
    CreateBlockerState,
    FormData
  >(createBlocker, null);
  const [updateState, updateFormAction, updatePending] = useActionState<
    UpdateBlockerState,
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

  const [parentKind, setParentKind] = useState<"task" | "project">(
    initial?.parentKind ?? presetParentKind ?? "task",
  );
  const [parentId, setParentId] = useState<string>(
    initial?.parentId ?? presetParentId ?? "",
  );
  const [isResolved, setIsResolved] = useState<boolean>(
    initial?.resolvedAt != null,
  );

  // Cambiar tipo de parent limpia la selección — task_id y project_id son
  // conjuntos distintos.
  function handleParentKindChange(next: "task" | "project") {
    setParentKind(next);
    setParentId("");
  }

  const parentOptions =
    parentKind === "task"
      ? tasks.map((t) => ({
          value: t.id,
          label: t.projectName
            ? `${t.title} · ${t.projectName}`
            : t.title,
        }))
      : projects.map((p) => ({ value: p.id, label: p.name }));

  const resolvedDate = initial?.resolvedAt
    ? initial.resolvedAt.slice(0, 10)
    : todayYmd();

  return (
    <form
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <Field label="Sobre qué bloquea" required>
        <div style={{ display: "flex", gap: 12 }}>
          <RadioOption
            label="Tarea"
            checked={parentKind === "task"}
            onChange={() => handleParentKindChange("task")}
          />
          <RadioOption
            label="Proyecto interno"
            checked={parentKind === "project"}
            onChange={() => handleParentKindChange("project")}
          />
        </div>
        {/* Hidden que el action recompone en task_id o internal_project_id. */}
        <input type="hidden" name="parent_kind" value={parentKind} />
      </Field>

      <Field
        label={parentKind === "task" ? "Tarea" : "Proyecto"}
        htmlFor="parent_id"
        required
      >
        <select
          id="parent_id"
          name="parent_id"
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          required
          style={inputStyle}
        >
          <option value="">
            — Elegí {parentKind === "task" ? "tarea" : "proyecto"} —
          </option>
          {parentOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {parentOptions.length === 0 && (
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-3)", marginTop: 6 }}
          >
            No hay {parentKind === "task" ? "tareas" : "proyectos"} cargadas.
            Creá una primero en la pestaña correspondiente.
          </div>
        )}
      </Field>

      <Field label="Motivo" htmlFor="reason" required>
        <textarea
          id="reason"
          name="reason"
          rows={3}
          required
          maxLength={2000}
          defaultValue={initial?.reason ?? ""}
          placeholder="Qué está impidiendo avanzar y qué se necesita para desbloquear"
          style={{ ...inputStyle, resize: "vertical", minHeight: 72 }}
        />
      </Field>

      <label
        htmlFor="__is_resolved"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          borderRadius: "var(--kg-r-8)",
          background: "var(--kg-surface-2-solid)",
          border: "1px solid var(--kg-border-subtle)",
          cursor: "pointer",
        }}
      >
        <input
          id="__is_resolved"
          type="checkbox"
          checked={isResolved}
          onChange={(e) => setIsResolved(e.target.checked)}
          style={{ cursor: "pointer" }}
        />
        <div style={{ flex: 1 }}>
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-1)", fontWeight: 600 }}
          >
            Marcado como resuelto
          </div>
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-3)", marginTop: 2 }}
          >
            Si lo desmarcás, el bloqueador vuelve a activo y se limpian
            fecha y quién lo resolvió.
          </div>
        </div>
      </label>

      {isResolved ? (
        <>
          <Field label="Fecha de resolución" htmlFor="resolved_at">
            <input
              id="resolved_at"
              name="resolved_at"
              type="date"
              defaultValue={resolvedDate}
              style={inputStyle}
            />
          </Field>
          <Field label="Resuelto por" htmlFor="resolved_by">
            <select
              id="resolved_by"
              name="resolved_by"
              defaultValue={initial?.resolvedBy ?? ""}
              style={inputStyle}
            >
              <option value="">— No registrado —</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                </option>
              ))}
            </select>
          </Field>
        </>
      ) : (
        // Enviamos vacíos explícitos para que el server limpie los campos
        // cuando el bloqueador vuelve a activo.
        <>
          <input type="hidden" name="resolved_at" value="" />
          <input type="hidden" name="resolved_by" value="" />
        </>
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
              : "Crear bloqueador"}
        </button>
      </div>
    </form>
  );
}

function RadioOption({
  label,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: () => void;
}) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 14px",
        borderRadius: "var(--kg-r-8)",
        background: checked
          ? "var(--kg-accent-500)"
          : "var(--kg-surface-2-solid)",
        border: `1px solid ${checked ? "var(--kg-accent-500)" : "var(--kg-border-subtle)"}`,
        color: checked ? "#fff" : "var(--kg-text-2)",
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
      }}
    >
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        style={{ display: "none" }}
      />
      {label}
    </label>
  );
}

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  readonly label: string;
  readonly htmlFor?: string;
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
