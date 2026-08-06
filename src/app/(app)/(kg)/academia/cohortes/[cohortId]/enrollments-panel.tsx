"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { EmptyState } from "@/components/kg/empty-state";
import { StatusPill } from "@/components/kg/status-pill";

import { deleteEnrollment } from "../../enrollments/actions";
import {
  EnrollStudentDrawer,
  type EnrollmentInitial,
  type SaleOptionForEnroll,
  type StudentOptionForEnroll,
} from "./enroll-student-drawer";

type Status = "active" | "completed" | "dropped" | "suspended";

export interface EnrollmentRowData {
  readonly id: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly saleId: string | null;
  readonly enrolledAt: string;
  readonly status: Status;
  readonly progressPercent: number;
  readonly notes: string | null;
}

const STATUS_LABEL: Record<Status, string> = {
  active: "Activo",
  completed: "Completado",
  dropped: "Abandonó",
  suspended: "Suspendido",
};

const STATUS_TONE: Record<Status, string> = {
  active: "var(--kg-positive-500)",
  completed: "var(--kg-accent-500)",
  dropped: "var(--kg-negative-500)",
  suspended: "var(--kg-warning-500)",
};

export function EnrollmentsPanel({
  cohortId,
  cohortName,
  cohortHasCourse,
  enrollments,
  availableStudents,
  availableSales,
}: {
  readonly cohortId: string;
  readonly cohortName: string;
  readonly cohortHasCourse: boolean;
  readonly enrollments: readonly EnrollmentRowData[];
  readonly availableStudents: readonly StudentOptionForEnroll[];
  readonly availableSales: readonly SaleOptionForEnroll[];
}) {
  const [enrolling, setEnrolling] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const editing =
    editingId != null
      ? enrollments.find((e) => e.id === editingId) ?? null
      : null;
  const editingInitial: EnrollmentInitial | undefined = editing
    ? {
        id: editing.id,
        studentId: editing.studentId,
        cohortId,
        saleId: editing.saleId,
        enrolledAt: editing.enrolledAt,
        status: editing.status,
        progressPercent: editing.progressPercent,
        notes: editing.notes,
      }
    : undefined;

  function handleDelete(row: EnrollmentRowData) {
    const ok = window.confirm(
      `¿Eliminar la inscripción de ${row.studentName}? La asistencia y exámenes de esa persona en esta generación NO se borran, pero pierden el link a la inscripción.`,
    );
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteEnrollment(row.id);
      if ("error" in result) setError(result.error);
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
          {enrollments.length === 0
            ? "Sin inscriptos"
            : `${enrollments.length} inscripto${enrollments.length === 1 ? "" : "s"}`}
        </div>
        <button
          type="button"
          onClick={() => setEnrolling(true)}
          className="kg-focus"
          style={primaryBtn}
        >
          + Inscribir
        </button>
      </div>

      {error && (
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
          {error}
        </div>
      )}

      {enrollments.length === 0 ? (
        <EmptyState
          title="Sin inscriptos en esta generación"
          hint="Inscribí estudiantes existentes. Si el curso de la generación matchea el producto de una venta, podés vincularla para trazabilidad LTV."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {enrollments.map((e) => (
            <div
              key={e.id}
              style={{
                padding: "10px 14px",
                borderRadius: "var(--kg-r-8)",
                background: "var(--kg-surface-2-solid)",
                border: "1px solid var(--kg-border-subtle)",
                display: "grid",
                gridTemplateColumns: "1fr auto auto",
                gap: 12,
                alignItems: "center",
              }}
            >
              <div>
                <Link
                  href={`/academia/estudiantes/${e.studentId}`}
                  className="kg-focus"
                  style={{
                    color: "var(--kg-text-1)",
                    textDecoration: "none",
                    fontWeight: 600,
                    fontSize: 13,
                  }}
                >
                  {e.studentName}
                </Link>
                <div
                  className="kg-t7"
                  style={{
                    color: "var(--kg-text-3)",
                    marginTop: 2,
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <span>desde {formatDate(e.enrolledAt)}</span>
                  {e.saleId && (
                    <span
                      style={{
                        padding: "1px 6px",
                        borderRadius: 4,
                        background: "var(--kg-surface-1-solid)",
                        color: "var(--kg-accent-text)",
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                      title="Inscripción vinculada a una venta de LaunchOS"
                    >
                      Auto
                    </span>
                  )}
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  alignItems: "flex-end",
                }}
              >
                <StatusPill
                  text={STATUS_LABEL[e.status]}
                  tone={STATUS_TONE[e.status]}
                />
                <div
                  className="kg-t7"
                  style={{
                    color: "var(--kg-text-3)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {e.progressPercent}% avance
                </div>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  type="button"
                  onClick={() => setEditingId(e.id)}
                  disabled={pending}
                  className="kg-focus"
                  style={rowBtn}
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(e)}
                  disabled={pending}
                  className="kg-focus"
                  style={{ ...rowBtn, color: "#EF4444", borderColor: "#EF4444" }}
                >
                  Quitar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <EnrollStudentDrawer
        mode="create"
        open={enrolling}
        onClose={() => setEnrolling(false)}
        cohortId={cohortId}
        cohortName={cohortName}
        cohortHasCourse={cohortHasCourse}
        students={availableStudents}
        sales={availableSales}
      />

      <EnrollStudentDrawer
        mode="edit"
        open={editingId != null}
        onClose={() => setEditingId(null)}
        cohortId={cohortId}
        cohortName={cohortName}
        cohortHasCourse={cohortHasCourse}
        students={availableStudents}
        sales={availableSales}
        initial={editingInitial}
      />
    </div>
  );
}

function formatDate(ymd: string): string {
  try {
    const d = ymd.length === 10 ? new Date(`${ymd}T12:00:00Z`) : new Date(ymd);
    return d.toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return ymd.slice(0, 10);
  }
}

const primaryBtn: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: 999,
  background: "var(--kg-accent-500)",
  border: "none",
  color: "#fff",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
};

const rowBtn: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
};
