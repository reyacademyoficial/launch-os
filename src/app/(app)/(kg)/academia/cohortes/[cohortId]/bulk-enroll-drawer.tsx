"use client";

import { useMemo, useState, useTransition } from "react";

import { Drawer } from "@/components/kg/drawer";
import { EmptyState } from "@/components/kg/empty-state";

import {
  bulkEnrollStudents,
  type BulkEnrollFailure,
} from "../../enrollments/actions";

export interface BulkEnrollCandidate {
  readonly studentId: string;
  readonly studentName: string;
  readonly studentEmail: string | null;
  readonly currentEnrollments: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Drawer para inscribir en masa a una cohort. Recibe candidatos = students
// del mismo proyecto que la cohort, NO inscriptos aún en esta cohort.
// Checkbox por fila + filtro por nombre + botón "Inscribir seleccionados".
// Los enrollments creados llevan sale_id=null (badge "Manual" en el
// listado).
// ═══════════════════════════════════════════════════════════════════════════

export function BulkEnrollDrawer({
  open,
  onClose,
  cohortId,
  cohortName,
  candidates,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly cohortId: string;
  readonly cohortName: string;
  readonly candidates: readonly BulkEnrollCandidate[];
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    enrolledCount: number;
    failures: readonly BulkEnrollFailure[];
  } | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return candidates;
    return candidates.filter((c) => {
      if (c.studentName.toLowerCase().includes(q)) return true;
      if (c.studentEmail && c.studentEmail.toLowerCase().includes(q))
        return true;
      return false;
    });
  }, [candidates, query]);

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllFiltered() {
    const filteredIds = filtered.map((c) => c.studentId);
    const allSelected =
      filteredIds.length > 0 &&
      filteredIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const id of filteredIds) next.delete(id);
      } else {
        for (const id of filteredIds) next.add(id);
      }
      return next;
    });
  }

  function handleConfirm() {
    if (selectedIds.size === 0) return;
    setError(null);
    setResult(null);
    const ids = Array.from(selectedIds);
    startTransition(async () => {
      const r = await bulkEnrollStudents(cohortId, ids);
      if ("error" in r) {
        setError(r.error);
        return;
      }
      setResult({ enrolledCount: r.enrolledCount, failures: r.failures });
      setSelectedIds(new Set());
    });
  }

  if (!open) return null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Inscribir varios"
      subtitle={cohortName}
      width={560}
    >
      {candidates.length === 0 ? (
        <EmptyState
          title="Sin estudiantes candidatos"
          hint="Todos los estudiantes del proyecto ya están inscriptos en esta generación, o el proyecto no tiene estudiantes cargados aún. Cargá alumnos desde /academia/estudiantes."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre o email…"
            style={inputStyle}
          />

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
              {filtered.length} candidato{filtered.length === 1 ? "" : "s"}
              {selectedIds.size > 0 &&
                ` · ${selectedIds.size} seleccionado${selectedIds.size === 1 ? "" : "s"}`}
            </div>
            <button
              type="button"
              onClick={toggleAllFiltered}
              disabled={pending || filtered.length === 0}
              className="kg-focus"
              style={secondaryBtn}
            >
              {filtered.length > 0 &&
              filtered.every((c) => selectedIds.has(c.studentId))
                ? "Limpiar visibles"
                : "Marcar visibles"}
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

          {result && (
            <div
              style={{
                padding: "10px 14px",
                borderRadius: "var(--kg-r-8)",
                background:
                  result.failures.length > 0
                    ? "rgba(255,184,0,0.08)"
                    : "rgba(34,197,94,0.08)",
                border: `1px solid ${result.failures.length > 0 ? "#FFB800" : "#22C55E"}`,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div
                style={{
                  color: "var(--kg-text-1)",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                Inscriptos {result.enrolledCount}
                {result.failures.length > 0 &&
                  ` · ${result.failures.length} fallaron`}
              </div>
              {result.failures.length > 0 && (
                <ul
                  style={{
                    margin: 0,
                    padding: "0 0 0 18px",
                    color: "var(--kg-text-2)",
                    fontSize: 12,
                    lineHeight: 1.5,
                  }}
                >
                  {result.failures.map((f, i) => {
                    const name =
                      candidates.find((c) => c.studentId === f.studentId)
                        ?.studentName ?? f.studentId;
                    return (
                      <li key={`${f.studentId}-${i}`}>
                        <strong>{name}</strong>: {f.error}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              maxHeight: "50vh",
              overflowY: "auto",
              paddingRight: 4,
            }}
          >
            {filtered.map((c) => {
              const checked = selectedIds.has(c.studentId);
              return (
                <label
                  key={c.studentId}
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
                      checked
                        ? "rgba(34,197,94,0.35)"
                        : "var(--kg-border-subtle)"
                    }`,
                    cursor: pending ? "not-allowed" : "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={pending}
                    onChange={() => toggle(c.studentId)}
                    style={{
                      cursor: pending ? "not-allowed" : "pointer",
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        color: "var(--kg-text-1)",
                        fontSize: 13,
                        fontWeight: 600,
                      }}
                    >
                      {c.studentName}
                    </div>
                    {c.studentEmail && (
                      <div
                        className="kg-t7"
                        style={{
                          color: "var(--kg-text-3)",
                          marginTop: 2,
                        }}
                      >
                        {c.studentEmail}
                      </div>
                    )}
                  </div>
                  <div
                    className="kg-t7"
                    style={{
                      color: "var(--kg-text-3)",
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap",
                    }}
                    title="Otras generaciones donde ya está inscripto"
                  >
                    {c.currentEnrollments > 0
                      ? `${c.currentEnrollments} gen.`
                      : "—"}
                  </div>
                </label>
              );
            })}
          </div>

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
              Cerrar
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={pending || selectedIds.size === 0}
              className="kg-focus"
              style={{
                ...primaryBtn,
                opacity: selectedIds.size === 0 || pending ? 0.5 : 1,
                cursor:
                  selectedIds.size === 0 || pending
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              {pending
                ? "Inscribiendo…"
                : `Inscribir seleccionados (${selectedIds.size})`}
            </button>
          </div>
        </div>
      )}
    </Drawer>
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
