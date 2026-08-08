"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/kg/empty-state";

import {
  CertificateFormDrawer,
  type CertificateInitial,
  type CourseOptionForCert,
  type StudentOptionForCert,
} from "./certificate-form-drawer";

export interface CertificateRowData {
  readonly id: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly courseId: string;
  readonly courseName: string;
  readonly projectName: string;
  readonly code: string | null;
  readonly issuedAt: string;
  readonly url: string | null;
  readonly notes: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Vista global de certificados emitidos. Tabla + drawer de emisión/edición.
// ═══════════════════════════════════════════════════════════════════════════

export function CertificadosView({
  certificates,
  students,
  courses,
}: {
  readonly certificates: readonly CertificateRowData[];
  readonly students: readonly StudentOptionForCert[];
  readonly courses: readonly CourseOptionForCert[];
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

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
        studentId: editing.studentId,
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
            ? "Sin certificados emitidos"
            : `${certificates.length} certificado${certificates.length === 1 ? "" : "s"}`}
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="kg-focus"
          style={primaryBtn}
        >
          + Emitir certificado
        </button>
      </div>

      {certificates.length === 0 ? (
        <EmptyState
          title="Sin certificados emitidos"
          hint="Los certificados son manuales — el operador los emite cuando el estudiante termina un curso. Un estudiante puede tener uno por curso. El código es opcional pero único global."
        />
      ) : (
        <div
          style={{
            overflowX: "auto",
            borderRadius: "var(--kg-r-8)",
            border: "1px solid var(--kg-border-subtle)",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
            }}
          >
            <thead>
              <tr
                style={{
                  background: "var(--kg-surface-2-solid)",
                  borderBottom: "1px solid var(--kg-border-subtle)",
                }}
              >
                <Th>Estudiante</Th>
                <Th>Curso</Th>
                <Th>Proyecto</Th>
                <Th>Código</Th>
                <Th>Emitido</Th>
                <Th>URL</Th>
                <Th align="right">&nbsp;</Th>
              </tr>
            </thead>
            <tbody>
              {certificates.map((c, idx) => (
                <tr
                  key={c.id}
                  style={{
                    borderBottom:
                      idx === certificates.length - 1
                        ? "none"
                        : "1px solid var(--kg-border-subtle)",
                  }}
                >
                  <Td>
                    <Link
                      href={`/academia/estudiantes/${c.studentId}`}
                      className="kg-focus"
                      style={{
                        color: "var(--kg-text-1)",
                        textDecoration: "none",
                        fontWeight: 600,
                      }}
                    >
                      {c.studentName}
                    </Link>
                  </Td>
                  <Td>{c.courseName}</Td>
                  <Td subtle>{c.projectName}</Td>
                  <Td subtle mono>
                    {c.code ?? "—"}
                  </Td>
                  <Td subtle>{formatDate(c.issuedAt)}</Td>
                  <Td>
                    {c.url ? (
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noreferrer"
                        className="kg-focus"
                        style={{
                          color: "var(--kg-accent-text)",
                          textDecoration: "none",
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        Ver ↗
                      </a>
                    ) : (
                      <span
                        style={{ color: "var(--kg-text-3)", fontSize: 12 }}
                      >
                        —
                      </span>
                    )}
                  </Td>
                  <Td align="right">
                    <button
                      type="button"
                      onClick={() => setEditingId(c.id)}
                      className="kg-focus"
                      style={rowBtn}
                    >
                      Editar
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CertificateFormDrawer
        mode="create"
        open={creating}
        onClose={() => setCreating(false)}
        students={students}
        courses={courses}
      />

      <CertificateFormDrawer
        mode="edit"
        open={editingId != null}
        onClose={() => setEditingId(null)}
        students={students}
        courses={courses}
        initial={editingInitial}
      />
    </div>
  );
}

function Th({
  children,
  align,
}: {
  readonly children: React.ReactNode;
  readonly align?: "right";
}) {
  return (
    <th
      style={{
        padding: "10px 14px",
        textAlign: align ?? "left",
        color: "var(--kg-text-3)",
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: 0.5,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  subtle,
  mono,
}: {
  readonly children: React.ReactNode;
  readonly align?: "right";
  readonly subtle?: boolean;
  readonly mono?: boolean;
}) {
  return (
    <td
      style={{
        padding: "10px 14px",
        textAlign: align ?? "left",
        color: subtle ? "var(--kg-text-3)" : "var(--kg-text-1)",
        fontSize: 13,
        fontFamily: mono ? "var(--kg-mono, monospace)" : "inherit",
        fontVariantNumeric: mono ? "tabular-nums" : "normal",
      }}
    >
      {children}
    </td>
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
