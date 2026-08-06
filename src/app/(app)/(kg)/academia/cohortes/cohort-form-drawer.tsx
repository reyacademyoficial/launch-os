"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";

import { Drawer } from "@/components/kg/drawer";

import {
  createCohort,
  deleteCohort,
  updateCohort,
  type CreateCohortState,
  type UpdateCohortState,
} from "./actions";

type Status = "planned" | "active" | "finished" | "cancelled";

const STATUS_OPTIONS: ReadonlyArray<{ value: Status; label: string }> = [
  { value: "planned", label: "Planeada" },
  { value: "active", label: "Activa" },
  { value: "finished", label: "Terminada" },
  { value: "cancelled", label: "Cancelada" },
];

export interface ProjectOptionForCohort {
  readonly id: string;
  readonly name: string;
}

export interface CourseOptionForCohort {
  readonly id: string;
  readonly productName: string;
  readonly projectId: string;
}

export interface CohortInitial {
  readonly id: string;
  readonly projectId: string;
  readonly courseId: string | null;
  readonly name: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly status: Status;
  readonly notes: string | null;
}

export function CohortFormDrawer({
  mode,
  open,
  onClose,
  projects,
  courses,
  initial,
  presetProjectId,
}: {
  readonly mode: "create" | "edit";
  readonly open: boolean;
  readonly onClose: () => void;
  readonly projects: readonly ProjectOptionForCohort[];
  readonly courses: readonly CourseOptionForCohort[];
  readonly initial?: CohortInitial;
  readonly presetProjectId?: string | null;
}) {
  if (!open) return null;
  const title = mode === "create" ? "Nueva cohorte" : "Editar cohorte";
  return (
    <Drawer open={open} onClose={onClose} title={title} width={560}>
      <CohortFormBody
        mode={mode}
        projects={projects}
        courses={courses}
        initial={initial}
        presetProjectId={presetProjectId}
        onClose={onClose}
      />
    </Drawer>
  );
}

function CohortFormBody({
  mode,
  projects,
  courses,
  initial,
  presetProjectId,
  onClose,
}: {
  readonly mode: "create" | "edit";
  readonly projects: readonly ProjectOptionForCohort[];
  readonly courses: readonly CourseOptionForCohort[];
  readonly initial?: CohortInitial;
  readonly presetProjectId?: string | null;
  readonly onClose: () => void;
}) {
  const isEdit = mode === "edit" && initial != null;

  const updateBound = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id;
    return async (prev: UpdateCohortState, fd: FormData) =>
      updateCohort(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createFormAction, createPending] = useActionState<
    CreateCohortState,
    FormData
  >(createCohort, null);
  const [updateState, updateFormAction, updatePending] = useActionState<
    UpdateCohortState,
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

  const [projectId, setProjectId] = useState<string>(
    initial?.projectId ?? presetProjectId ?? projects[0]?.id ?? "",
  );
  const [courseId, setCourseId] = useState<string>(
    initial?.courseId ?? "",
  );
  const [startDate, setStartDate] = useState<string>(initial?.startDate ?? "");
  const [endDate, setEndDate] = useState<string>(initial?.endDate ?? "");

  const [deletePending, startDeleteTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const coursesForProject = courses.filter((c) => c.projectId === projectId);

  function handleProjectChange(nextId: string) {
    setProjectId(nextId);
    // Si el curso actual no pertenece al nuevo project, limpiar.
    if (
      courseId &&
      !courses.some((c) => c.id === courseId && c.projectId === nextId)
    ) {
      setCourseId("");
    }
  }

  function handleDelete() {
    if (!isEdit || !initial) return;
    const ok = window.confirm(
      `¿Eliminar la cohorte "${initial.name}"? Si tiene inscripciones, clases o exámenes va a rebotar — cerrala (status Terminada o Cancelada) para preservar historial.`,
    );
    if (!ok) return;
    setDeleteError(null);
    startDeleteTransition(async () => {
      const result = await deleteCohort(initial.id);
      if ("error" in result) {
        setDeleteError(result.error);
        return;
      }
      onClose();
    });
  }

  if (projects.length === 0) {
    return (
      <div style={{ padding: 12 }}>
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", lineHeight: 1.55 }}
        >
          No hay proyectos propios. Academia requiere al menos un project con
          ownership='propia'. Ver banner en /academia para el SQL de setup.
        </div>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <Field label="Proyecto propio" htmlFor="project_id" required>
        <select
          id="project_id"
          name="project_id"
          value={projectId}
          onChange={(e) => handleProjectChange(e.target.value)}
          required
          style={inputStyle}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Curso (opcional)" htmlFor="course_id">
        <select
          id="course_id"
          name="course_id"
          value={courseId}
          onChange={(e) => setCourseId(e.target.value)}
          disabled={coursesForProject.length === 0}
          style={inputStyle}
        >
          <option value="">— Sin curso —</option>
          {coursesForProject.map((c) => (
            <option key={c.id} value={c.id}>
              {c.productName}
            </option>
          ))}
        </select>
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginTop: 6 }}
        >
          {coursesForProject.length === 0
            ? "El proyecto no tiene cursos cargados. Podés dejar la cohorte sin curso, pero no podrás vincularla a ventas de LaunchOS."
            : "Solo se listan cursos del proyecto seleccionado."}
        </div>
      </Field>

      <Field label="Nombre" htmlFor="name" required>
        <input
          id="name"
          name="name"
          type="text"
          required
          maxLength={200}
          defaultValue={initial?.name ?? ""}
          placeholder="Ej. Cohorte 2026-Q1"
          style={inputStyle}
        />
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Inicio" htmlFor="start_date" required>
          <input
            id="start_date"
            name="start_date"
            type="date"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Fin" htmlFor="end_date" required>
          <input
            id="end_date"
            name="end_date"
            type="date"
            required
            value={endDate}
            min={startDate || undefined}
            onChange={(e) => setEndDate(e.target.value)}
            style={inputStyle}
          />
        </Field>
      </div>

      <Field label="Estado" htmlFor="status" required>
        <select
          id="status"
          name="status"
          defaultValue={initial?.status ?? "planned"}
          style={inputStyle}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

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
          >
            {deletePending ? "Eliminando…" : "Eliminar cohorte"}
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
                : "Crear cohorte"}
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
