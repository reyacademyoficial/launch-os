"use client";

import { useActionState, useEffect, useMemo, useState } from "react";

import { Drawer } from "@/components/kg/drawer";
import { fMoney } from "@/lib/finance/format";

import {
  createEnrollment,
  updateEnrollment,
  type CreateEnrollmentState,
  type UpdateEnrollmentState,
} from "../../enrollments/actions";

const STATUS_OPTIONS = [
  { value: "active", label: "Activo" },
  { value: "completed", label: "Completado" },
  { value: "dropped", label: "Abandonó" },
  { value: "suspended", label: "Suspendido" },
] as const;

type Status = (typeof STATUS_OPTIONS)[number]["value"];

export interface StudentOptionForEnroll {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
}

/** Sale del mismo producto que el course de la cohort — vinculable. */
export interface SaleOptionForEnroll {
  readonly id: string;
  readonly leadName: string;
  readonly amount: number;
  readonly currency: "ARS" | "USD";
  readonly createdAt: string;
}

export interface EnrollmentInitial {
  readonly id: string;
  readonly studentId: string;
  readonly cohortId: string;
  readonly saleId: string | null;
  readonly enrolledAt: string;
  readonly status: Status;
  readonly progressPercent: number;
  readonly notes: string | null;
}

export function EnrollStudentDrawer({
  mode,
  open,
  onClose,
  cohortId,
  cohortName,
  cohortHasCourse,
  students,
  sales,
  initial,
}: {
  readonly mode: "create" | "edit";
  readonly open: boolean;
  readonly onClose: () => void;
  readonly cohortId: string;
  readonly cohortName: string;
  readonly cohortHasCourse: boolean;
  readonly students: readonly StudentOptionForEnroll[];
  readonly sales: readonly SaleOptionForEnroll[];
  readonly initial?: EnrollmentInitial;
}) {
  if (!open) return null;
  const title = mode === "create" ? "Inscribir estudiante" : "Editar inscripción";
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      subtitle={cohortName}
      width={560}
    >
      <EnrollBody
        mode={mode}
        cohortId={cohortId}
        cohortHasCourse={cohortHasCourse}
        students={students}
        sales={sales}
        initial={initial}
        onClose={onClose}
      />
    </Drawer>
  );
}

function EnrollBody({
  mode,
  cohortId,
  cohortHasCourse,
  students,
  sales,
  initial,
  onClose,
}: {
  readonly mode: "create" | "edit";
  readonly cohortId: string;
  readonly cohortHasCourse: boolean;
  readonly students: readonly StudentOptionForEnroll[];
  readonly sales: readonly SaleOptionForEnroll[];
  readonly initial?: EnrollmentInitial;
  readonly onClose: () => void;
}) {
  const isEdit = mode === "edit" && initial != null;

  const updateBound = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id;
    return async (prev: UpdateEnrollmentState, fd: FormData) =>
      updateEnrollment(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createFormAction, createPending] = useActionState<
    CreateEnrollmentState,
    FormData
  >(createEnrollment, null);
  const [updateState, updateFormAction, updatePending] = useActionState<
    UpdateEnrollmentState,
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

  const [saleId, setSaleId] = useState<string>(initial?.saleId ?? "");

  if (students.length === 0) {
    return (
      <div style={{ padding: 12 }}>
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", lineHeight: 1.55 }}
        >
          No hay estudiantes activos en el proyecto de esta generación. Cargá
          alguno primero en{" "}
          <a
            href="/academia/estudiantes"
            style={{ color: "var(--kg-accent-500)" }}
          >
            Estudiantes
          </a>{" "}
          (podés hacerlo desde comprador para auto-fillear).
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
          defaultValue={initial?.studentId ?? students[0]?.id ?? ""}
          required
          disabled={isEdit}
          style={inputStyle}
        >
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.email ? ` · ${s.email}` : ""}
            </option>
          ))}
        </select>
        {isEdit && (
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-3)", marginTop: 6 }}
          >
            El estudiante no se puede cambiar en la edición — eliminá y creá
            otra inscripción si aplica.
          </div>
        )}
      </Field>

      <Field label="Venta asociada (opcional)" htmlFor="sale_id">
        <select
          id="sale_id"
          name="sale_id"
          value={saleId}
          onChange={(e) => setSaleId(e.target.value)}
          disabled={!cohortHasCourse}
          style={inputStyle}
        >
          <option value="">— Sin venta (carga manual) —</option>
          {sales.map((s) => (
            <option key={s.id} value={s.id}>
              {s.leadName} · {formatMoney(s.amount, s.currency)} ·{" "}
              {formatDate(s.createdAt)}
            </option>
          ))}
        </select>
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginTop: 6 }}
        >
          {!cohortHasCourse
            ? "La generación no tiene curso asociado — no se pueden vincular ventas. Asignale un curso primero."
            : sales.length === 0
              ? "No hay ventas del mismo producto que este curso, sin inscripción previa."
              : "Solo se listan ventas del mismo producto que el curso de esta generación. El vínculo alimenta la trazabilidad LTV / cohort."}
        </div>
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Fecha inscripción" htmlFor="enrolled_at" required>
          <input
            id="enrolled_at"
            name="enrolled_at"
            type="date"
            defaultValue={initial?.enrolledAt ?? todayYmd()}
            required
            style={inputStyle}
          />
        </Field>
        <Field label="Estado" htmlFor="status" required>
          <select
            id="status"
            name="status"
            defaultValue={initial?.status ?? "active"}
            style={inputStyle}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Progreso (%)" htmlFor="progress_percent">
        <input
          id="progress_percent"
          name="progress_percent"
          type="number"
          min={0}
          max={100}
          step={1}
          defaultValue={initial?.progressPercent ?? 0}
          style={inputStyle}
        />
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginTop: 6 }}
        >
          Se actualiza manualmente por el operador. La "finalización" formal
          es marcar status=Completado.
        </div>
      </Field>

      <Field label="Notas" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={2}
          defaultValue={initial?.notes ?? ""}
          placeholder="Opcional"
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
          disabled={pending}
          className="kg-focus"
          style={{ ...primaryBtn, opacity: pending ? 0.7 : 1 }}
        >
          {pending
            ? isEdit
              ? "Guardando…"
              : "Inscribiendo…"
            : isEdit
              ? "Guardar cambios"
              : "Inscribir"}
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

function formatMoney(amount: number, currency: "ARS" | "USD"): string {
  const raw = fMoney(amount);
  const prefix = currency === "USD" ? "US$" : "AR$";
  return raw.replace(/^(-?)\$/, `$1${prefix} `);
}

function formatDate(iso: string): string {
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
