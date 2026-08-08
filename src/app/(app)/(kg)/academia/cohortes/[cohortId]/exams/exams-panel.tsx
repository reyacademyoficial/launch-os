"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/kg/empty-state";
import { StatusPill } from "@/components/kg/status-pill";

import {
  ExamFormDrawer,
  type ExamInitial,
  type StudentOptionForExam,
} from "./exam-form-drawer";

export interface ExamRowData {
  readonly id: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly title: string;
  readonly takenAt: string;
  readonly score: number | null;
  readonly passed: boolean | null;
  readonly notes: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Panel de exámenes dentro de la ficha de una generación.
//
// Header con contador + botón "+ Nuevo examen". Lista ordenada por
// taken_at desc con nombre del estudiante (link a ficha), título, fecha,
// nota y badge de estado (Pendiente/Aprobado/Reprobado).
// ═══════════════════════════════════════════════════════════════════════════

export function ExamsPanel({
  cohortId,
  cohortName,
  exams,
  studentOptions,
}: {
  readonly cohortId: string;
  readonly cohortName: string;
  readonly exams: readonly ExamRowData[];
  readonly studentOptions: readonly StudentOptionForExam[];
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const editing = useMemo(
    () =>
      editingId != null ? exams.find((e) => e.id === editingId) ?? null : null,
    [editingId, exams],
  );
  const editingInitial: ExamInitial | undefined = editing
    ? {
        id: editing.id,
        cohortId,
        studentId: editing.studentId,
        title: editing.title,
        score: editing.score,
        passed: editing.passed,
        takenAt: editing.takenAt,
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
          {exams.length === 0
            ? "Sin exámenes"
            : `${exams.length} examen${exams.length === 1 ? "" : "es"}`}
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="kg-focus"
          style={primaryBtn}
        >
          + Nuevo examen
        </button>
      </div>

      {exams.length === 0 ? (
        <EmptyState
          title="Sin exámenes registrados"
          hint="Cargá el resultado de un examen por estudiante. La nota es opcional (0-100) — dejala vacía si aún no corregiste. El estado (Pendiente/Aprobado/Reprobado) es independiente."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {exams.map((e) => (
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
              <div style={{ minWidth: 0 }}>
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
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {e.title} · {formatDate(e.takenAt)}
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
                  text={statusLabel(e.passed)}
                  tone={statusTone(e.passed)}
                />
                <div
                  className="kg-t7"
                  style={{
                    color: "var(--kg-text-3)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {e.score == null ? "Sin nota" : `${formatScore(e.score)} pts`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingId(e.id)}
                className="kg-focus"
                style={rowBtn}
              >
                Editar
              </button>
            </div>
          ))}
        </div>
      )}

      <ExamFormDrawer
        mode="create"
        open={creating}
        onClose={() => setCreating(false)}
        cohortId={cohortId}
        cohortName={cohortName}
        students={studentOptions}
      />

      <ExamFormDrawer
        mode="edit"
        open={editingId != null}
        onClose={() => setEditingId(null)}
        cohortId={cohortId}
        cohortName={cohortName}
        students={studentOptions}
        initial={editingInitial}
      />
    </div>
  );
}

function statusLabel(passed: boolean | null): string {
  if (passed == null) return "Pendiente";
  return passed ? "Aprobado" : "Reprobado";
}

function statusTone(passed: boolean | null): string {
  if (passed == null) return "var(--kg-neutral-500)";
  return passed ? "var(--kg-positive-500)" : "var(--kg-negative-500)";
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

function formatScore(score: number): string {
  // Muestra sin decimales si es entero, con hasta 2 si tiene coma.
  const rounded = Math.round(score * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(/\.?0+$/, "");
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
