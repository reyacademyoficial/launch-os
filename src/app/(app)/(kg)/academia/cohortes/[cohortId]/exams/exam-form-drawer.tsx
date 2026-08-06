"use client";

import {
  useActionState,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";

import { Drawer } from "@/components/kg/drawer";

import {
  createExam,
  deleteExam,
  updateExam,
  type CreateExamState,
  type UpdateExamState,
} from "./actions";

export interface StudentOptionForExam {
  readonly studentId: string;
  readonly studentName: string;
}

export interface ExamInitial {
  readonly id: string;
  readonly cohortId: string;
  readonly studentId: string;
  readonly title: string;
  readonly score: number | null;
  readonly passed: boolean | null;
  readonly takenAt: string;
  readonly notes: string | null;
}

type PassedState = "pending" | "passed" | "failed";

function passedToState(passed: boolean | null): PassedState {
  if (passed == null) return "pending";
  return passed ? "passed" : "failed";
}

export function ExamFormDrawer({
  mode,
  open,
  onClose,
  cohortId,
  cohortName,
  students,
  initial,
}: {
  readonly mode: "create" | "edit";
  readonly open: boolean;
  readonly onClose: () => void;
  readonly cohortId: string;
  readonly cohortName: string;
  readonly students: readonly StudentOptionForExam[];
  readonly initial?: ExamInitial;
}) {
  if (!open) return null;
  const title = mode === "create" ? "Nuevo examen" : "Editar examen";
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      subtitle={cohortName}
      width={540}
    >
      <ExamFormBody
        mode={mode}
        cohortId={cohortId}
        students={students}
        initial={initial}
        onClose={onClose}
      />
    </Drawer>
  );
}

function ExamFormBody({
  mode,
  cohortId,
  students,
  initial,
  onClose,
}: {
  readonly mode: "create" | "edit";
  readonly cohortId: string;
  readonly students: readonly StudentOptionForExam[];
  readonly initial?: ExamInitial;
  readonly onClose: () => void;
}) {
  const isEdit = mode === "edit" && initial != null;

  const updateBound = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id;
    return async (prev: UpdateExamState, fd: FormData) =>
      updateExam(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createFormAction, createPending] = useActionState<
    CreateExamState,
    FormData
  >(createExam, null);
  const [updateState, updateFormAction, updatePending] = useActionState<
    UpdateExamState,
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

  const [studentId, setStudentId] = useState<string>(
    initial?.studentId ?? students[0]?.studentId ?? "",
  );
  const [passedState, setPassedState] = useState<PassedState>(
    initial ? passedToState(initial.passed) : "pending",
  );

  const [deletePending, startDeleteTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function handleDelete() {
    if (!isEdit || !initial) return;
    const ok = window.confirm(
      `¿Eliminar el examen "${initial.title}"? La acción no se puede deshacer.`,
    );
    if (!ok) return;
    setDeleteError(null);
    startDeleteTransition(async () => {
      const result = await deleteExam(initial.id);
      if ("error" in result) {
        setDeleteError(result.error);
        return;
      }
      onClose();
    });
  }

  if (students.length === 0) {
    return (
      <div style={{ padding: 12 }}>
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", lineHeight: 1.55 }}
        >
          No hay inscriptos en esta generación. Inscribí estudiantes en el
          panel de arriba y volvé para registrar exámenes.
        </div>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <input type="hidden" name="cohort_id" value={cohortId} />

      <Field label="Estudiante" htmlFor="student_id" required>
        <select
          id="student_id"
          name="student_id"
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          required
          style={inputStyle}
        >
          {students.map((s) => (
            <option key={s.studentId} value={s.studentId}>
              {s.studentName}
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
          maxLength={200}
          defaultValue={initial?.title ?? ""}
          placeholder="Ej. Parcial 1 · Módulo 3"
          style={inputStyle}
        />
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Fecha" htmlFor="taken_at" required>
          <input
            id="taken_at"
            name="taken_at"
            type="date"
            required
            defaultValue={initial?.takenAt ?? todayYmd()}
            style={inputStyle}
          />
        </Field>
        <Field label="Nota (0-100)" htmlFor="score">
          <input
            id="score"
            name="score"
            type="number"
            min={0}
            max={100}
            step="0.01"
            defaultValue={initial?.score != null ? String(initial.score) : ""}
            placeholder="Sin corregir"
            style={inputStyle}
          />
        </Field>
      </div>

      <Field label="Estado" htmlFor="passed_state" required>
        <div
          role="radiogroup"
          aria-label="Estado del examen"
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}
        >
          <RadioPill
            name="passed_state"
            value="pending"
            checked={passedState === "pending"}
            onChange={() => setPassedState("pending")}
            label="Pendiente"
            tone="neutral"
          />
          <RadioPill
            name="passed_state"
            value="passed"
            checked={passedState === "passed"}
            onChange={() => setPassedState("passed")}
            label="Aprobado"
            tone="positive"
          />
          <RadioPill
            name="passed_state"
            value="failed"
            checked={passedState === "failed"}
            onChange={() => setPassedState("failed")}
            label="Reprobado"
            tone="negative"
          />
        </div>
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginTop: 6, lineHeight: 1.5 }}
        >
          Pendiente = aún no se decidió. Aprobado/Reprobado son
          independientes de la nota (podés setear estado sin nota, o nota sin
          estado).
        </div>
      </Field>

      <Field label="Notas" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={2}
          defaultValue={initial?.notes ?? ""}
          placeholder="Observaciones libres"
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
            {deletePending ? "Eliminando…" : "Eliminar examen"}
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
                : "Crear examen"}
          </button>
        </div>
      </div>
    </form>
  );
}

function RadioPill({
  name,
  value,
  checked,
  onChange,
  label,
  tone,
}: {
  readonly name: string;
  readonly value: string;
  readonly checked: boolean;
  readonly onChange: () => void;
  readonly label: string;
  readonly tone: "neutral" | "positive" | "negative";
}) {
  const activeColor =
    tone === "positive"
      ? "#22C55E"
      : tone === "negative"
        ? "#EF4444"
        : "var(--kg-text-2)";
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: "8px 10px",
        borderRadius: 999,
        background: checked ? "rgba(255,255,255,0.04)" : "transparent",
        border: `1px solid ${checked ? activeColor : "var(--kg-border-subtle)"}`,
        color: checked ? activeColor : "var(--kg-text-3)",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        style={{ display: "none" }}
      />
      {label}
    </label>
  );
}

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
