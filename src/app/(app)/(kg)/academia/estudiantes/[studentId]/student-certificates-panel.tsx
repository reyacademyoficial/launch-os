"use client";

import { useMemo, useState } from "react";

import { EmptyState } from "@/components/kg/empty-state";

import {
  CertificateFormDrawer,
  type CertificateInitial,
  type CourseOptionForCert,
  type StudentOptionForCert,
} from "../../certificados/certificate-form-drawer";

export interface StudentCertRowData {
  readonly id: string;
  readonly courseId: string;
  readonly courseName: string;
  readonly code: string | null;
  readonly issuedAt: string;
  readonly url: string | null;
  readonly notes: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Panel de certificados dentro de la ficha del estudiante.
//
// Reusa el drawer global de /academia/certificados con student presetado
// (la lista de students trae solo al actual — el select del drawer queda
// bloqueado). El drawer de edición permite cambiar todo excepto el
// student.
// ═══════════════════════════════════════════════════════════════════════════

export function StudentCertificatesPanel({
  studentId,
  studentName,
  studentProjectId,
  studentProjectName,
  certificates,
  courses,
}: {
  readonly studentId: string;
  readonly studentName: string;
  readonly studentProjectId: string;
  readonly studentProjectName: string;
  readonly certificates: readonly StudentCertRowData[];
  readonly courses: readonly CourseOptionForCert[];
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // El drawer necesita students y courses. Le pasamos solo el student
  // actual (evita mostrar el select con TODOS) y los courses del mismo
  // proyecto para el picker interno.
  const studentOptions: StudentOptionForCert[] = useMemo(
    () => [
      {
        id: studentId,
        name: studentName,
        projectId: studentProjectId,
        projectName: studentProjectName,
      },
    ],
    [studentId, studentName, studentProjectId, studentProjectName],
  );

  const editing = useMemo(
    () =>
      editingId != null
        ? certificates.find((c) => c.id === editingId) ?? null
        : null,
    [editingId, certificates],
  );
  const editingInitial: CertificateInitial | undefined = editing
    ? {
        id: editing.id,
        studentId,
        courseId: editing.courseId,
        code: editing.code,
        issuedAt: editing.issuedAt,
        url: editing.url,
        notes: editing.notes,
      }
    : undefined;

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
          {certificates.length === 0
            ? "Sin certificados"
            : `${certificates.length} certificado${certificates.length === 1 ? "" : "s"}`}
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="kg-focus"
          style={primaryBtn}
        >
          + Emitir
        </button>
      </div>

      {certificates.length === 0 ? (
        <EmptyState
          title="Sin certificados emitidos"
          hint="Cuando el estudiante termine un curso, emití el certificado desde acá. Uno por curso."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {certificates.map((c) => (
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
                  style={{
                    color: "var(--kg-text-1)",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {c.courseName}
                </div>
                <div
                  className="kg-t7"
                  style={{
                    color: "var(--kg-text-3)",
                    marginTop: 2,
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    flexWrap: "wrap",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  <span>{formatDate(c.issuedAt)}</span>
                  {c.code && (
                    <span
                      style={{
                        padding: "1px 6px",
                        borderRadius: 4,
                        background: "var(--kg-surface-1-solid)",
                        color: "var(--kg-text-2)",
                        fontSize: 10,
                        fontWeight: 700,
                        fontFamily: "var(--kg-mono, monospace)",
                      }}
                    >
                      {c.code}
                    </span>
                  )}
                </div>
              </div>
              {c.url ? (
                <a
                  href={c.url}
                  target="_blank"
                  rel="noreferrer"
                  className="kg-focus"
                  style={{
                    color: "var(--kg-accent-text)",
                    textDecoration: "none",
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  Ver ↗
                </a>
              ) : (
                <span style={{ color: "var(--kg-text-3)", fontSize: 11 }}>
                  Sin URL
                </span>
              )}
              <button
                type="button"
                onClick={() => setEditingId(c.id)}
                className="kg-focus"
                style={rowBtn}
              >
                Editar
              </button>
            </div>
          ))}
        </div>
      )}

      <CertificateFormDrawer
        mode="create"
        open={creating}
        onClose={() => setCreating(false)}
        students={studentOptions}
        courses={courses}
        presetStudentId={studentId}
      />

      <CertificateFormDrawer
        mode="edit"
        open={editingId != null}
        onClose={() => setEditingId(null)}
        students={studentOptions}
        courses={courses}
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
