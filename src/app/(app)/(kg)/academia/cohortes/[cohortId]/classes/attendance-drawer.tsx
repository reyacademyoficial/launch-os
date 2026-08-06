"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import { Drawer } from "@/components/kg/drawer";

import { bulkSetAttendance } from "./actions";

export interface AttendanceStudentRow {
  readonly studentId: string;
  readonly studentName: string;
  readonly present: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Matriz de asistencia para una clase. Recibe todos los inscriptos
// "vigentes" (active/completed) con su valor actual de present (o false
// si aún no hay fila de attendance registrada).
//
// UX: checkbox por estudiante + botones masivos "Marcar todos" y
// "Desmarcar todos". Un solo botón Guardar que upsertea todo. Sin
// concepto de "no registrado": si el student aparece en la matriz, tiene
// fila cuando se guarda.
// ═══════════════════════════════════════════════════════════════════════════

export function AttendanceDrawer({
  open,
  onClose,
  classId,
  classLabel,
  cohortName,
  initialRows,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly classId: string;
  readonly classLabel: string;
  readonly cohortName: string;
  readonly initialRows: readonly AttendanceStudentRow[];
}) {
  if (!open) return null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Asistencia · ${classLabel}`}
      subtitle={cohortName}
      width={560}
    >
      <AttendanceBody
        classId={classId}
        initialRows={initialRows}
        onClose={onClose}
      />
    </Drawer>
  );
}

function AttendanceBody({
  classId,
  initialRows,
  onClose,
}: {
  readonly classId: string;
  readonly initialRows: readonly AttendanceStudentRow[];
  readonly onClose: () => void;
}) {
  const [presentMap, setPresentMap] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {};
    for (const r of initialRows) m[r.studentId] = r.present;
    return m;
  });

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const stats = useMemo(() => {
    const total = initialRows.length;
    const marked = Object.values(presentMap).filter(Boolean).length;
    return { marked, total };
  }, [presentMap, initialRows.length]);

  function togglePresent(studentId: string) {
    setPresentMap((m) => ({ ...m, [studentId]: !m[studentId] }));
  }

  function markAll(value: boolean) {
    const next: Record<string, boolean> = {};
    for (const r of initialRows) next[r.studentId] = value;
    setPresentMap(next);
  }

  function handleSave() {
    setError(null);
    const entries = initialRows.map((r) => ({
      studentId: r.studentId,
      present: !!presentMap[r.studentId],
    }));
    startTransition(async () => {
      const result = await bulkSetAttendance(classId, entries);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      onClose();
    });
  }

  if (initialRows.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", lineHeight: 1.55 }}
        >
          No hay inscriptos vigentes (activos o completados) en esta generación.
          Inscribí estudiantes desde el panel superior para poder tomar asistencia.
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            className="kg-focus"
            style={secondaryBtn}
          >
            Cerrar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div
          className="kg-t7"
          style={{
            color: "var(--kg-text-3)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {stats.marked}/{stats.total} marcados
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            onClick={() => markAll(true)}
            disabled={pending}
            className="kg-focus"
            style={pillBtn}
          >
            Marcar todos
          </button>
          <button
            type="button"
            onClick={() => markAll(false)}
            disabled={pending}
            className="kg-focus"
            style={pillBtn}
          >
            Limpiar
          </button>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          maxHeight: "60vh",
          overflowY: "auto",
          paddingRight: 4,
        }}
      >
        {initialRows.map((r) => {
          const checked = !!presentMap[r.studentId];
          return (
            <label
              key={r.studentId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                borderRadius: "var(--kg-r-8)",
                background: checked
                  ? "rgba(34,197,94,0.08)"
                  : "var(--kg-surface-2-solid)",
                border: `1px solid ${
                  checked ? "rgba(34,197,94,0.35)" : "var(--kg-border-subtle)"
                }`,
                cursor: pending ? "not-allowed" : "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={pending}
                onChange={() => togglePresent(r.studentId)}
                style={{ cursor: "pointer", flexShrink: 0 }}
              />
              <span
                style={{
                  flex: 1,
                  color: "var(--kg-text-1)",
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                {r.studentName}
              </span>
              <span
                className="kg-t7"
                style={{
                  color: checked ? "#22C55E" : "var(--kg-text-3)",
                  fontWeight: 600,
                }}
              >
                {checked ? "Presente" : "Ausente"}
              </span>
            </label>
          );
        })}
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
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="kg-focus"
          style={{ ...primaryBtn, opacity: pending ? 0.7 : 1 }}
        >
          {pending ? "Guardando…" : "Guardar asistencia"}
        </button>
      </div>
    </div>
  );
}

const pillBtn: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
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
