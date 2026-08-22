"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

import { StatusPill } from "@/components/kg/status-pill";
import type { ParameterType } from "@/lib/academia/parameters";

import { setParameterValueAction } from "../parameter-values-actions";
import { EnrollmentExpireButton } from "./enrollment-expire-button";

// ═══════════════════════════════════════════════════════════════════════════
// Ficha unificada del alumno — Fase H · task #1.
//
// Un EnrollmentCard agrupa TODA la info del alumno respecto de un enrollment:
//   - Curso + generación + sistema (si aplica)
//   - Estado + badge de vigencia + barra de progreso + botón "Dar de baja"
//   - Módulos completados / pendientes (si progress_source in ('ghl_tags',
//     'manual'))
//   - Parámetros del curso (inline, editables si canEdit)
//
// Es un client component porque los parámetros son editables y usan
// useTransition + server action. El resto es render puro sobre la data ya
// resuelta en el server.
// ═══════════════════════════════════════════════════════════════════════════

export interface EnrollmentCardModule {
  readonly moduleId: string;
  readonly moduleName: string;
  readonly orderIndex: number;
  readonly completedAt: string | null;
  readonly source: "ghl_tag" | "manual" | null;
}

export interface EnrollmentCardParameter {
  readonly parameterId: string;
  readonly key: string;
  readonly label: string;
  readonly type: ParameterType;
  readonly required: boolean;
  readonly currentValue: boolean | number | string | null;
}

export interface EnrollmentCardData {
  readonly enrollmentId: string;
  readonly cohortId: string;
  readonly cohortName: string;
  readonly courseId: string | null;
  readonly courseName: string;
  readonly systemName: string | null;
  readonly status: "active" | "completed" | "dropped" | "suspended" | "expired";
  readonly progressPercent: number;
  readonly enrolledAt: string;
  readonly accessExpiresAt: string | null;
  readonly saleId: string | null;
  readonly progressSource: "attendance" | "ghl_tags" | "manual";
  readonly modules: readonly EnrollmentCardModule[];
  readonly parameters: readonly EnrollmentCardParameter[];
}

const ENROLL_STATUS_LABEL: Record<EnrollmentCardData["status"], string> = {
  active: "Activo",
  completed: "Completado",
  dropped: "Abandonó",
  suspended: "Suspendido",
  expired: "Vencido",
};

const ENROLL_STATUS_TONE: Record<EnrollmentCardData["status"], string> = {
  active: "var(--kg-positive-500)",
  completed: "var(--kg-accent-500)",
  dropped: "var(--kg-negative-500)",
  suspended: "var(--kg-warning-500)",
  expired: "var(--kg-negative-500)",
};

type AccessBadge = { label: string; tone: string };

function computeAccessBadge(
  status: EnrollmentCardData["status"],
  accessExpiresAt: string | null,
): AccessBadge | null {
  if (status === "expired") {
    return { label: "Vencido", tone: "var(--kg-negative-500)" };
  }
  if (!accessExpiresAt) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expDate = new Date(`${accessExpiresAt}T12:00:00Z`);
  const diffDays = Math.floor(
    (expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays < 0) return { label: "Vencido", tone: "var(--kg-negative-500)" };
  if (diffDays <= 7) {
    return {
      label: `Por vencer · ${diffDays}d`,
      tone: "var(--kg-warning-500)",
    };
  }
  return { label: "Vigente", tone: "var(--kg-positive-500)" };
}

export function EnrollmentCard({
  studentId,
  data,
  canExpire,
  canEditParameters,
}: {
  readonly studentId: string;
  readonly data: EnrollmentCardData;
  readonly canExpire: boolean;
  readonly canEditParameters: boolean;
}) {
  const badge = computeAccessBadge(data.status, data.accessExpiresAt);
  const showModules =
    data.progressSource === "ghl_tags" || data.progressSource === "manual";
  const completedModules = data.modules.filter((m) => m.completedAt != null);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding: "16px 18px",
        borderRadius: "var(--kg-r-8)",
        background: "var(--kg-surface-2-solid)",
        border: "1px solid var(--kg-border-subtle)",
      }}
    >
      {/* Header: curso + generación + sistema + badges + acciones */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) auto",
          gap: 12,
          alignItems: "start",
        }}
      >
        <div style={{ minWidth: 0 }}>
          {data.courseId ? (
            <Link
              href={`/academia/cursos/${data.courseId}`}
              className="kg-focus"
              style={{
                color: "var(--kg-text-1)",
                textDecoration: "none",
                fontWeight: 700,
                fontSize: 15,
              }}
            >
              {data.courseName}
            </Link>
          ) : (
            <span
              style={{
                color: "var(--kg-text-1)",
                fontWeight: 700,
                fontSize: 15,
              }}
            >
              {data.courseName}
            </span>
          )}
          <div
            className="kg-t7"
            style={{
              color: "var(--kg-text-3)",
              marginTop: 4,
              display: "flex",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <Link
              href={`/academia/cohortes/${data.cohortId}`}
              className="kg-focus"
              style={{
                color: "var(--kg-text-2)",
                textDecoration: "none",
                fontWeight: 600,
              }}
            >
              {data.cohortName}
            </Link>
            {data.systemName && (
              <span
                style={{
                  padding: "1px 6px",
                  borderRadius: 4,
                  background: "var(--kg-surface-1-solid)",
                  color: "var(--kg-text-2)",
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                {data.systemName}
              </span>
            )}
            <span>desde {formatDate(data.enrolledAt)}</span>
            {data.accessExpiresAt && (
              <span>vence {formatDate(data.accessExpiresAt)}</span>
            )}
            {data.saleId && (
              <span
                title="Inscripción vinculada a una venta de LaunchOS"
                style={{
                  padding: "1px 6px",
                  borderRadius: 4,
                  background: "var(--kg-surface-1-solid)",
                  color: "var(--kg-accent-text)",
                  fontSize: 10,
                  fontWeight: 700,
                }}
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
            gap: 6,
            alignItems: "flex-end",
          }}
        >
          <StatusPill
            text={ENROLL_STATUS_LABEL[data.status]}
            tone={ENROLL_STATUS_TONE[data.status]}
          />
          {badge && <StatusPill text={badge.label} tone={badge.tone} />}
          {canExpire && data.status === "active" && (
            <EnrollmentExpireButton
              enrollmentId={data.enrollmentId}
              studentId={studentId}
              cohortLabel={data.cohortName}
            />
          )}
        </div>
      </div>

      {/* Barra de progreso */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
          }}
        >
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-3)", fontWeight: 600 }}
          >
            Progreso ({data.progressSource})
          </div>
          <div
            className="kg-t7"
            style={{
              color: "var(--kg-text-2)",
              fontVariantNumeric: "tabular-nums",
              fontWeight: 700,
            }}
          >
            {showModules
              ? `${completedModules.length}/${data.modules.length} · ${data.progressPercent}%`
              : `${data.progressPercent}%`}
          </div>
        </div>
        <div
          role="progressbar"
          aria-valuenow={data.progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          style={{
            height: 6,
            borderRadius: 999,
            background: "var(--kg-surface-1-solid)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${Math.max(0, Math.min(100, data.progressPercent))}%`,
              height: "100%",
              background: "var(--kg-accent-500)",
              transition: "width 240ms ease",
            }}
          />
        </div>
      </div>

      {/* Módulos (solo si progress_source lo justifica) */}
      {showModules && (
        <ModulesBlock modules={data.modules} />
      )}

      {/* Parámetros (siempre — muestra vacío si no hay) */}
      <ParametersBlock
        studentId={studentId}
        enrollmentId={data.enrollmentId}
        parameters={data.parameters}
        canEdit={canEditParameters}
      />
    </div>
  );
}

function ModulesBlock({
  modules,
}: {
  readonly modules: readonly EnrollmentCardModule[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        className="kg-t7"
        style={{ color: "var(--kg-text-3)", fontWeight: 600 }}
      >
        Módulos
      </div>
      {modules.length === 0 ? (
        <div
          className="kg-t7"
          style={{
            color: "var(--kg-text-3)",
            fontStyle: "italic",
            padding: "4px 0",
          }}
        >
          El curso no tiene módulos cargados todavía.
        </div>
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {modules.map((m) => {
            const done = m.completedAt != null;
            return (
              <li
                key={m.moduleId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "4px 0",
                  fontSize: 12,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 999,
                    background: done
                      ? "var(--kg-positive-500)"
                      : "var(--kg-surface-1-solid)",
                    border: `1px solid ${done ? "var(--kg-positive-500)" : "var(--kg-border-subtle)"}`,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    color: done ? "var(--kg-text-1)" : "var(--kg-text-3)",
                    fontWeight: done ? 600 : 400,
                  }}
                >
                  {m.orderIndex + 1}. {m.moduleName}
                </span>
                {done && m.completedAt && (
                  <span
                    className="kg-t7"
                    style={{
                      color: "var(--kg-text-3)",
                      marginLeft: "auto",
                    }}
                  >
                    {formatIsoDate(m.completedAt)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ParametersBlock({
  studentId,
  enrollmentId,
  parameters,
  canEdit,
}: {
  readonly studentId: string;
  readonly enrollmentId: string;
  readonly parameters: readonly EnrollmentCardParameter[];
  readonly canEdit: boolean;
}) {
  if (parameters.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", fontWeight: 600 }}
        >
          Parámetros
        </div>
        <div
          className="kg-t7"
          style={{
            color: "var(--kg-text-3)",
            fontStyle: "italic",
            padding: "4px 0",
          }}
        >
          Sin parámetros configurados para este curso.
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        className="kg-t7"
        style={{ color: "var(--kg-text-3)", fontWeight: 600 }}
      >
        Parámetros
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {parameters.map((p) => (
          <ParameterRow
            key={p.parameterId}
            studentId={studentId}
            enrollmentId={enrollmentId}
            parameter={p}
            canEdit={canEdit}
          />
        ))}
      </div>
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
  readonly parameter: EnrollmentCardParameter;
  readonly canEdit: boolean;
}) {
  const initial = useMemo(() => toEditableValue(parameter), [parameter]);
  const [value, setValue] = useState<boolean | number | string>(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

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
          style={{
            color: "var(--kg-text-1)",
            fontSize: 12,
            fontWeight: 600,
          }}
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
  p: EnrollmentCardParameter,
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

function formatIsoDate(iso: string): string {
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
