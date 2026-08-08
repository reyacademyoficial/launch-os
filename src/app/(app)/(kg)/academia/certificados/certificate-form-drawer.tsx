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
  createCertificate,
  deleteCertificate,
  updateCertificate,
  type CreateCertificateState,
  type UpdateCertificateState,
} from "./actions";

export interface StudentOptionForCert {
  readonly id: string;
  readonly name: string;
  readonly projectId: string;
  readonly projectName: string;
}

export interface CourseOptionForCert {
  readonly id: string;
  readonly productName: string;
  readonly projectId: string;
}

export interface CertificateInitial {
  readonly id: string;
  readonly studentId: string;
  readonly courseId: string;
  readonly code: string | null;
  readonly issuedAt: string;
  readonly url: string | null;
  readonly notes: string | null;
}

export function CertificateFormDrawer({
  mode,
  open,
  onClose,
  students,
  courses,
  initial,
  presetStudentId,
}: {
  readonly mode: "create" | "edit";
  readonly open: boolean;
  readonly onClose: () => void;
  readonly students: readonly StudentOptionForCert[];
  readonly courses: readonly CourseOptionForCert[];
  readonly initial?: CertificateInitial;
  readonly presetStudentId?: string | null;
}) {
  if (!open) return null;
  const title = mode === "create" ? "Emitir certificado" : "Editar certificado";
  return (
    <Drawer open={open} onClose={onClose} title={title} width={560}>
      <CertificateFormBody
        mode={mode}
        students={students}
        courses={courses}
        initial={initial}
        presetStudentId={presetStudentId}
        onClose={onClose}
      />
    </Drawer>
  );
}

function CertificateFormBody({
  mode,
  students,
  courses,
  initial,
  presetStudentId,
  onClose,
}: {
  readonly mode: "create" | "edit";
  readonly students: readonly StudentOptionForCert[];
  readonly courses: readonly CourseOptionForCert[];
  readonly initial?: CertificateInitial;
  readonly presetStudentId?: string | null;
  readonly onClose: () => void;
}) {
  const isEdit = mode === "edit" && initial != null;

  const updateBound = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id;
    return async (prev: UpdateCertificateState, fd: FormData) =>
      updateCertificate(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createFormAction, createPending] = useActionState<
    CreateCertificateState,
    FormData
  >(createCertificate, null);
  const [updateState, updateFormAction, updatePending] = useActionState<
    UpdateCertificateState,
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
    initial?.studentId ?? presetStudentId ?? students[0]?.id ?? "",
  );
  const [courseId, setCourseId] = useState<string>(initial?.courseId ?? "");

  const [deletePending, startDeleteTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const selectedStudent = students.find((s) => s.id === studentId) ?? null;
  const coursesForStudent = selectedStudent
    ? courses.filter((c) => c.projectId === selectedStudent.projectId)
    : [];

  function handleStudentChange(nextId: string) {
    setStudentId(nextId);
    const next = students.find((s) => s.id === nextId) ?? null;
    if (
      courseId &&
      next &&
      !courses.some((c) => c.id === courseId && c.projectId === next.projectId)
    ) {
      setCourseId("");
    }
  }

  function handleDelete() {
    if (!isEdit || !initial) return;
    const ok = window.confirm(
      "¿Eliminar el certificado? La acción no se puede deshacer.",
    );
    if (!ok) return;
    setDeleteError(null);
    startDeleteTransition(async () => {
      const result = await deleteCertificate(initial.id);
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
          No hay estudiantes cargados en proyectos propios. Creá alumnos
          desde /academia/estudiantes y volvé para emitir certificados.
        </div>
      </div>
    );
  }

  const studentLocked = isEdit || presetStudentId != null;

  return (
    <form
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <Field label="Estudiante" htmlFor="student_id" required>
        <select
          id="student_id"
          name="student_id"
          value={studentId}
          onChange={(e) => handleStudentChange(e.target.value)}
          required
          disabled={studentLocked}
          style={{ ...inputStyle, opacity: studentLocked ? 0.7 : 1 }}
        >
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {s.projectName}
            </option>
          ))}
        </select>
        {studentLocked && (
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-3)", marginTop: 6 }}
          >
            {isEdit
              ? "Para cambiar de estudiante, eliminá este certificado y emití uno nuevo."
              : "Estudiante fijado desde la ficha."}
          </div>
        )}
      </Field>

      <Field label="Curso" htmlFor="course_id" required>
        <select
          id="course_id"
          name="course_id"
          value={courseId}
          onChange={(e) => setCourseId(e.target.value)}
          required
          disabled={coursesForStudent.length === 0}
          style={inputStyle}
        >
          <option value="">— Elegí un curso —</option>
          {coursesForStudent.map((c) => (
            <option key={c.id} value={c.id}>
              {c.productName}
            </option>
          ))}
        </select>
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginTop: 6, lineHeight: 1.5 }}
        >
          {coursesForStudent.length === 0
            ? "El proyecto del estudiante no tiene cursos cargados. Andá a /academia/cursos y creá uno."
            : "Solo se listan cursos del mismo proyecto que el estudiante."}
        </div>
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Código" htmlFor="code">
          <input
            id="code"
            name="code"
            type="text"
            maxLength={100}
            defaultValue={initial?.code ?? ""}
            placeholder="Ej. REY-2026-0042"
            style={inputStyle}
          />
        </Field>
        <Field label="Fecha emisión" htmlFor="issued_at" required>
          <input
            id="issued_at"
            name="issued_at"
            type="date"
            required
            defaultValue={initial?.issuedAt ?? todayYmd()}
            style={inputStyle}
          />
        </Field>
      </div>

      <Field label="URL del certificado" htmlFor="url">
        <input
          id="url"
          name="url"
          type="url"
          defaultValue={initial?.url ?? ""}
          placeholder="https://…"
          style={inputStyle}
        />
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginTop: 6 }}
        >
          Link al PDF, drive público, o página de verificación. Opcional.
        </div>
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
            {deletePending ? "Eliminando…" : "Eliminar certificado"}
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
                : "Emitiendo…"
              : isEdit
                ? "Guardar cambios"
                : "Emitir certificado"}
          </button>
        </div>
      </div>
    </form>
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
