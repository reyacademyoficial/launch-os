"use client";

import { useEffect, useState, useTransition } from "react";

import type { ParameterType } from "@/lib/academia/parameters";

import {
  deleteParameterAction,
  reorderParametersAction,
  upsertParameter,
} from "./parameters-actions";

// ═══════════════════════════════════════════════════════════════════════════
// Editor inline de course_parameters — se monta dentro del CourseFormDrawer
// en modo edit. En modo create se muestra un placeholder que le pide al
// usuario guardar primero (necesitamos el courseId para el FK).
// ═══════════════════════════════════════════════════════════════════════════

const TYPE_LABEL: Record<ParameterType, string> = {
  boolean: "Booleano (si/no)",
  integer: "Entero",
  text: "Texto",
};

const TYPE_OPTIONS: readonly ParameterType[] = ["boolean", "integer", "text"];

export interface ParameterRowData {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly type: ParameterType;
  readonly required: boolean;
  readonly orderIndex: number;
}

export function ParametersEditor({
  courseId,
  parameters,
}: {
  readonly courseId: string;
  readonly parameters: readonly ParameterRowData[];
}) {
  // Copia local para permitir reorder optimista + edición inline.
  const [rows, setRows] = useState<readonly ParameterRowData[]>(parameters);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    setRows(parameters);
  }, [parameters]);

  function handleSaved(newRow: ParameterRowData, mode: "create" | "update") {
    if (mode === "create") {
      setRows((prev) => [...prev, newRow]);
      setShowNew(false);
    } else {
      setRows((prev) => prev.map((r) => (r.id === newRow.id ? newRow : r)));
    }
    setError(null);
  }

  function handleDelete(id: string) {
    const target = rows.find((r) => r.id === id);
    const ok = window.confirm(
      `¿Eliminar el parámetro "${target?.label ?? ""}"? Se van a borrar todos los valores registrados a alumnos.`,
    );
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteParameterAction(id, courseId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== id));
    });
  }

  function move(id: string, dir: -1 | 1) {
    const idx = rows.findIndex((r) => r.id === id);
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= rows.length) return;
    const next = rows.slice();
    const a = next[idx];
    const b = next[target];
    if (!a || !b) return;
    next[idx] = b;
    next[target] = a;
    setRows(next);
    setError(null);
    startTransition(async () => {
      const result = await reorderParametersAction(
        courseId,
        next.map((r) => r.id),
      );
      if ("error" in result) {
        setError(result.error);
        // Revertimos si falló.
        setRows(rows);
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
          Cada parámetro se puede completar por alumno desde su ficha.
        </div>
        <button
          type="button"
          onClick={() => setShowNew((s) => !s)}
          disabled={pending}
          className="kg-focus"
          style={secondaryBtn}
        >
          {showNew ? "Cancelar" : "+ Nuevo parámetro"}
        </button>
      </div>

      {rows.length === 0 && !showNew && (
        <div
          className="kg-t7"
          style={{
            color: "var(--kg-text-3)",
            fontStyle: "italic",
            padding: "6px 2px",
          }}
        >
          Sin parámetros configurados.
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {rows.map((r, i) => (
            <ParameterRow
              key={r.id}
              row={r}
              courseId={courseId}
              canMoveUp={i > 0}
              canMoveDown={i < rows.length - 1}
              onSaved={(saved) => handleSaved(saved, "update")}
              onDelete={() => handleDelete(r.id)}
              onMove={(dir) => move(r.id, dir)}
              disabled={pending}
            />
          ))}
        </div>
      )}

      {showNew && (
        <ParameterNewForm
          courseId={courseId}
          onSaved={(saved) => handleSaved(saved, "create")}
          onCancel={() => setShowNew(false)}
        />
      )}

      {error && (
        <div
          style={{
            padding: "8px 12px",
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
    </div>
  );
}

function ParameterRow({
  row,
  courseId,
  canMoveUp,
  canMoveDown,
  onSaved,
  onDelete,
  onMove,
  disabled,
}: {
  readonly row: ParameterRowData;
  readonly courseId: string;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly onSaved: (row: ParameterRowData) => void;
  readonly onDelete: () => void;
  readonly onMove: (dir: -1 | 1) => void;
  readonly disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <ParameterInlineForm
        courseId={courseId}
        initial={row}
        onSaved={(saved) => {
          onSaved(saved);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div
      style={{
        padding: "8px 10px",
        borderRadius: "var(--kg-r-8)",
        background: "var(--kg-surface-2-solid)",
        border: "1px solid var(--kg-border-subtle)",
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: 8,
        alignItems: "center",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={!canMoveUp || disabled}
          className="kg-focus"
          style={arrowBtn}
          aria-label="Subir"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={!canMoveDown || disabled}
          className="kg-focus"
          style={arrowBtn}
          aria-label="Bajar"
        >
          ↓
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div
          style={{ color: "var(--kg-text-1)", fontWeight: 600, fontSize: 13 }}
        >
          {row.label}
          {row.required && (
            <span
              aria-hidden="true"
              style={{ color: "#EF4444", marginLeft: 4 }}
            >
              *
            </span>
          )}
        </div>
        <div
          className="kg-t7"
          style={{
            color: "var(--kg-text-3)",
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <code>{row.key}</code>
          <span>· {TYPE_LABEL[row.type]}</span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={disabled}
          className="kg-focus"
          style={smallBtn}
        >
          Editar
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={disabled}
          className="kg-focus"
          style={dangerSmallBtn}
        >
          Quitar
        </button>
      </div>
    </div>
  );
}

function ParameterNewForm({
  courseId,
  onSaved,
  onCancel,
}: {
  readonly courseId: string;
  readonly onSaved: (row: ParameterRowData) => void;
  readonly onCancel: () => void;
}) {
  return (
    <ParameterInlineForm
      courseId={courseId}
      initial={null}
      onSaved={onSaved}
      onCancel={onCancel}
    />
  );
}

function ParameterInlineForm({
  courseId,
  initial,
  onSaved,
  onCancel,
}: {
  readonly courseId: string;
  readonly initial: ParameterRowData | null;
  readonly onSaved: (row: ParameterRowData) => void;
  readonly onCancel: () => void;
}) {
  const [key, setKey] = useState(initial?.key ?? "");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [type, setType] = useState<ParameterType>(initial?.type ?? "boolean");
  const [required, setRequired] = useState(initial?.required ?? false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    const fd = new FormData();
    if (initial) fd.set("parameter_id", initial.id);
    fd.set("course_id", courseId);
    fd.set("key", key);
    fd.set("label", label);
    fd.set("type", type);
    if (required) fd.set("required", "on");
    startTransition(async () => {
      const result = await upsertParameter(null, fd);
      if (!result) {
        setError("Sin respuesta del servidor.");
        return;
      }
      if ("error" in result) {
        setError(result.error);
        return;
      }
      onSaved({
        id: result.parameterId,
        key: key.trim(),
        label: label.trim(),
        type,
        required,
        orderIndex: initial?.orderIndex ?? 0,
      });
    });
  }

  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: "var(--kg-r-8)",
        background: "var(--kg-surface-2-solid)",
        border: "1px solid var(--kg-accent-500)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}
      >
        <label
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", display: "grid", gap: 4 }}
        >
          Key
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="p.ej. diagnostico"
            style={inputStyle}
          />
        </label>
        <label
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", display: "grid", gap: 4 }}
        >
          Label
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="p.ej. Diagnóstico hecho"
            style={inputStyle}
          />
        </label>
      </div>
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}
      >
        <label
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", display: "grid", gap: 4 }}
        >
          Tipo
          <select
            value={type}
            onChange={(e) => setType(e.target.value as ParameterType)}
            style={inputStyle}
          >
            {TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            paddingTop: 20,
          }}
        >
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
          />
          <span
            className="kg-t7"
            style={{ color: "var(--kg-text-2)", fontWeight: 600 }}
          >
            Requerido
          </span>
        </label>
      </div>
      {error && (
        <div style={{ color: "#EF4444", fontSize: 12 }}>{error}</div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="kg-focus"
          style={secondaryBtn}
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="kg-focus"
          style={{ ...primaryBtn, opacity: pending ? 0.7 : 1 }}
        >
          {pending ? "Guardando…" : initial ? "Guardar" : "Agregar"}
        </button>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 10px",
  borderRadius: "var(--kg-r-8)",
  background: "var(--kg-surface-1-solid)",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-1)",
  fontSize: 12,
  colorScheme: "dark",
};

const primaryBtn: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 999,
  background: "var(--kg-accent-500)",
  border: "none",
  color: "#fff",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryBtn: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
};

const smallBtn: React.CSSProperties = {
  padding: "3px 9px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 10,
  fontWeight: 700,
  cursor: "pointer",
};

const dangerSmallBtn: React.CSSProperties = {
  padding: "3px 9px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid #EF4444",
  color: "#EF4444",
  fontSize: 10,
  fontWeight: 700,
  cursor: "pointer",
};

const arrowBtn: React.CSSProperties = {
  width: 22,
  height: 18,
  padding: 0,
  borderRadius: 4,
  background: "transparent",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 10,
  fontWeight: 700,
  cursor: "pointer",
  lineHeight: 1,
};
