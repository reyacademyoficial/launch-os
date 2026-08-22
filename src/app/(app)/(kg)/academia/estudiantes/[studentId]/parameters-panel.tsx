"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import type { ParameterType } from "@/lib/academia/parameters";

import { setParameterValueAction } from "../parameter-values-actions";

// ═══════════════════════════════════════════════════════════════════════════
// Panel de parámetros del alumno — Fase B.
//
// Lista TODOS los parámetros de los cursos donde el student tiene enrollment,
// agrupados por generación (enrollment). Muestra el valor actual y permite
// cambiarlo si el caller tiene can_edit_project (`canEdit` prop). El botón
// "Guardar" dispara la server action, que revalida la ficha del alumno.
// ═══════════════════════════════════════════════════════════════════════════

export interface EnrollmentGroup {
  readonly enrollmentId: string;
  readonly courseId: string;
  readonly cohortId: string;
  readonly cohortName: string;
  readonly courseName: string;
  readonly parameters: readonly EnrollmentParameterEntry[];
}

export interface EnrollmentParameterEntry {
  readonly parameterId: string;
  readonly key: string;
  readonly label: string;
  readonly type: ParameterType;
  readonly required: boolean;
  readonly currentValue: boolean | number | string | null;
}

export function ParametersPanel({
  studentId,
  canEdit,
  groups,
}: {
  readonly studentId: string;
  readonly canEdit: boolean;
  readonly groups: readonly EnrollmentGroup[];
}) {
  if (groups.length === 0) {
    return (
      <div
        className="kg-t7"
        style={{ color: "var(--kg-text-3)", padding: "6px 2px" }}
      >
        El alumno no está inscripto en ninguna generación con parámetros
        configurados.
      </div>
    );
  }

  const hasAnyParameter = groups.some((g) => g.parameters.length > 0);
  if (!hasAnyParameter) {
    return (
      <div
        className="kg-t7"
        style={{ color: "var(--kg-text-3)", padding: "6px 2px" }}
      >
        Ninguno de los cursos del alumno tiene parámetros configurados. Andá a
        Academia → Cursos → editar el curso para agregarlos.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {groups.map((g) => (
        <EnrollmentBlock
          key={g.enrollmentId}
          studentId={studentId}
          group={g}
          canEdit={canEdit}
        />
      ))}
    </div>
  );
}

function EnrollmentBlock({
  studentId,
  group,
  canEdit,
}: {
  readonly studentId: string;
  readonly group: EnrollmentGroup;
  readonly canEdit: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "10px 12px",
        borderRadius: "var(--kg-r-8)",
        background: "var(--kg-surface-2-solid)",
        border: "1px solid var(--kg-border-subtle)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 8,
        }}
      >
        <div
          style={{ color: "var(--kg-text-1)", fontWeight: 700, fontSize: 13 }}
        >
          {group.courseName}
        </div>
        <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
          {group.cohortName}
        </div>
      </div>
      {group.parameters.length === 0 ? (
        <div
          className="kg-t7"
          style={{
            color: "var(--kg-text-3)",
            fontStyle: "italic",
          }}
        >
          Sin parámetros para este curso.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {group.parameters.map((p) => (
            <ParameterRow
              key={p.parameterId}
              studentId={studentId}
              enrollmentId={group.enrollmentId}
              parameter={p}
              canEdit={canEdit}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ParameterRow({
  studentId,
  enrollmentId,
  parameter,
  canEdit,
}: {
  readonly studentId: string;
  readonly enrollmentId: string;
  readonly parameter: EnrollmentParameterEntry;
  readonly canEdit: boolean;
}) {
  const initial = useMemo(() => toEditableValue(parameter), [parameter]);
  const [value, setValue] = useState<boolean | number | string>(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setValue(initial);
  }, [initial]);

  const isDirty = !isSameValue(parameter.type, value, initial);

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await setParameterValueAction({
        enrollmentId,
        parameterId: parameter.parameterId,
        studentId,
        type: parameter.type,
        value,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setSavedAt(Date.now());
    });
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr) auto",
        gap: 10,
        alignItems: "center",
        padding: "6px 8px",
        borderRadius: 6,
        background: "var(--kg-surface-1-solid)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div
          style={{ color: "var(--kg-text-1)", fontSize: 12, fontWeight: 600 }}
        >
          {parameter.label}
          {parameter.required && (
            <span
              aria-hidden="true"
              style={{ color: "#EF4444", marginLeft: 4 }}
            >
              *
            </span>
          )}
        </div>
        <code
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", fontSize: 10 }}
        >
          {parameter.key}
        </code>
      </div>
      <ValueControl
        type={parameter.type}
        value={value}
        onChange={setValue}
        disabled={!canEdit || pending}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {error && (
          <span style={{ color: "#EF4444", fontSize: 10 }}>{error}</span>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={save}
            disabled={pending || !isDirty}
            className="kg-focus"
            style={{
              padding: "4px 10px",
              borderRadius: 999,
              background: isDirty
                ? "var(--kg-accent-500)"
                : "var(--kg-surface-2-solid)",
              border: isDirty ? "none" : "1px solid var(--kg-border-subtle)",
              color: isDirty ? "#fff" : "var(--kg-text-3)",
              fontSize: 10,
              fontWeight: 700,
              cursor: isDirty && !pending ? "pointer" : "default",
              opacity: pending ? 0.6 : 1,
            }}
          >
            {pending ? "…" : savedAt && !isDirty ? "Guardado" : "Guardar"}
          </button>
        )}
      </div>
    </div>
  );
}

function ValueControl({
  type,
  value,
  onChange,
  disabled,
}: {
  readonly type: ParameterType;
  readonly value: boolean | number | string;
  readonly onChange: (v: boolean | number | string) => void;
  readonly disabled: boolean;
}) {
  if (type === "boolean") {
    return (
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          color: "var(--kg-text-2)",
        }}
      >
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
        />
        <span>{value === true ? "Sí" : "No"}</span>
      </label>
    );
  }
  if (type === "integer") {
    return (
      <input
        type="number"
        step={1}
        value={typeof value === "number" ? value : ""}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") {
            onChange(0);
            return;
          }
          const n = Number(raw);
          if (Number.isFinite(n)) onChange(Math.trunc(n));
        }}
        disabled={disabled}
        style={inputStyle}
      />
    );
  }
  // text
  return (
    <input
      type="text"
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      style={inputStyle}
    />
  );
}

function toEditableValue(
  p: EnrollmentParameterEntry,
): boolean | number | string {
  if (p.type === "boolean") {
    return typeof p.currentValue === "boolean" ? p.currentValue : false;
  }
  if (p.type === "integer") {
    return typeof p.currentValue === "number" ? p.currentValue : 0;
  }
  return typeof p.currentValue === "string" ? p.currentValue : "";
}

function isSameValue(
  type: ParameterType,
  a: boolean | number | string,
  b: boolean | number | string,
): boolean {
  if (type === "boolean") return Boolean(a) === Boolean(b);
  if (type === "integer") return Number(a) === Number(b);
  return String(a) === String(b);
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "5px 9px",
  borderRadius: 6,
  background: "var(--kg-surface-2-solid)",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-1)",
  fontSize: 12,
  colorScheme: "dark",
};
