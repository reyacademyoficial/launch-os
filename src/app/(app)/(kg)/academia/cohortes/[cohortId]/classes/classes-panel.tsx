"use client";

import { useMemo, useState } from "react";

import { EmptyState } from "@/components/kg/empty-state";

import {
  AttendanceDrawer,
  type AttendanceStudentRow,
} from "./attendance-drawer";
import { ClassFormDrawer, type ClassInitial } from "./class-form-drawer";

export interface ClassRowData {
  readonly id: string;
  readonly scheduledAtIso: string;
  readonly topic: string | null;
  readonly notes: string | null;
  readonly presentCount: number;
}

export interface EnrolledStudentForAttendance {
  readonly studentId: string;
  readonly studentName: string;
}

export interface AttendanceMapForClass {
  readonly [classId: string]: ReadonlyArray<{
    readonly studentId: string;
    readonly present: boolean;
  }>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Panel de clases dentro de la ficha de una generación.
//
// Header con contador + botón "+ Nueva clase". Lista de clases ordenada por
// fecha desc con fecha formateada, tema, N/M asistieron, y acciones:
// Asistencia / Editar / (Eliminar vive dentro del drawer de edición).
// ═══════════════════════════════════════════════════════════════════════════

export function ClassesPanel({
  cohortId,
  cohortName,
  classes,
  enrolledStudents,
  attendanceByClass,
}: {
  readonly cohortId: string;
  readonly cohortName: string;
  readonly classes: readonly ClassRowData[];
  readonly enrolledStudents: readonly EnrolledStudentForAttendance[];
  readonly attendanceByClass: AttendanceMapForClass;
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [attendanceForId, setAttendanceForId] = useState<string | null>(null);

  const editing = useMemo(
    () =>
      editingId != null ? classes.find((c) => c.id === editingId) ?? null : null,
    [editingId, classes],
  );
  const editingInitial: ClassInitial | undefined = editing
    ? {
        id: editing.id,
        cohortId,
        scheduledAtIso: editing.scheduledAtIso,
        topic: editing.topic,
        notes: editing.notes,
      }
    : undefined;

  const attendanceClass = useMemo(
    () =>
      attendanceForId != null
        ? classes.find((c) => c.id === attendanceForId) ?? null
        : null,
    [attendanceForId, classes],
  );

  const attendanceInitialRows: readonly AttendanceStudentRow[] = useMemo(() => {
    if (!attendanceClass) return [];
    const existing = attendanceByClass[attendanceClass.id] ?? [];
    const presentByStudent = new Map<string, boolean>();
    for (const a of existing) presentByStudent.set(a.studentId, a.present);
    return enrolledStudents.map((s) => ({
      studentId: s.studentId,
      studentName: s.studentName,
      present: presentByStudent.get(s.studentId) ?? false,
    }));
  }, [attendanceClass, attendanceByClass, enrolledStudents]);

  const total = enrolledStudents.length;

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
          {classes.length === 0
            ? "Sin clases"
            : `${classes.length} clase${classes.length === 1 ? "" : "s"}`}
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="kg-focus"
          style={primaryBtn}
        >
          + Nueva clase
        </button>
      </div>

      {classes.length === 0 ? (
        <EmptyState
          title="Sin clases todavía"
          hint="Programá la primera sesión de la generación. Después vas a poder marcar asistencia por clase para todos los inscriptos de una."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {classes.map((c) => (
            <div
              key={c.id}
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
              <div style={{ minWidth: 0 }}>
                <div
                  suppressHydrationWarning
                  style={{
                    color: "var(--kg-text-1)",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {formatDateTime(c.scheduledAtIso)}
                </div>
                <div
                  className="kg-t7"
                  style={{
                    color: "var(--kg-text-3)",
                    marginTop: 2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.topic ?? "Sin tema"}
                </div>
              </div>
              <div
                className="kg-t7"
                style={{
                  color: "var(--kg-text-3)",
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                }}
                title="Presentes / Inscriptos vigentes"
              >
                {c.presentCount}/{total} asistieron
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  type="button"
                  onClick={() => setAttendanceForId(c.id)}
                  className="kg-focus"
                  style={rowBtnPrimary}
                >
                  Asistencia
                </button>
                <button
                  type="button"
                  onClick={() => setEditingId(c.id)}
                  className="kg-focus"
                  style={rowBtn}
                >
                  Editar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ClassFormDrawer
        mode="create"
        open={creating}
        onClose={() => setCreating(false)}
        cohortId={cohortId}
        cohortName={cohortName}
      />

      <ClassFormDrawer
        mode="edit"
        open={editingId != null}
        onClose={() => setEditingId(null)}
        cohortId={cohortId}
        cohortName={cohortName}
        initial={editingInitial}
      />

      <AttendanceDrawer
        open={attendanceForId != null}
        onClose={() => setAttendanceForId(null)}
        classId={attendanceClass?.id ?? ""}
        classLabel={
          attendanceClass ? formatDateTime(attendanceClass.scheduledAtIso) : ""
        }
        cohortName={cohortName}
        initialRows={attendanceInitialRows}
      />
    </div>
  );
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("es-AR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso.slice(0, 16);
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

const rowBtnPrimary: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid var(--kg-accent-500)",
  color: "var(--kg-accent-text)",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
};
