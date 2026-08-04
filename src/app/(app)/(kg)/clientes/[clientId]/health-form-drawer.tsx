"use client";

import { useActionState, useEffect, useMemo, useState } from "react";

import { Drawer } from "@/components/kg/drawer";
import type { RelationshipStatus } from "@/lib/clients/types";

import { upsertProjectHealth, type UpsertHealthState } from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer para cargar o editar el health del cliente.
//
// Como project_health tiene unique(client_id), es efectivamente una fila
// por cliente. El drawer no distingue crear vs editar: siempre upsert. El
// título cambia según haya o no fila previa (para dar contexto al operador).
// ═══════════════════════════════════════════════════════════════════════════

const STATUS_OPTIONS: ReadonlyArray<{
  value: RelationshipStatus;
  label: string;
  hint: string;
}> = [
  {
    value: "onboarding",
    label: "Onboarding",
    hint: "Cliente nuevo, todavía no llegó a régimen.",
  },
  {
    value: "activa",
    label: "Activa",
    hint: "Relación en régimen, sin señales de riesgo.",
  },
  {
    value: "en_riesgo",
    label: "En riesgo",
    hint: "Churn probable — señales negativas (contacto ausente, tickets no resueltos, NPS bajo).",
  },
  {
    value: "perdida",
    label: "Perdida",
    hint: "Churn confirmado — el cliente no renueva o cortó la relación.",
  },
];

export interface HealthInitial {
  readonly relationshipStatus: RelationshipStatus;
  readonly healthScore: number | null;
  readonly lastContactAt: string | null;
  readonly notes: string | null;
}

export function HealthFormDrawer({
  clientId,
  clientName,
  hasCurrent,
  open,
  onClose,
  initial,
}: {
  readonly clientId: string;
  readonly clientName: string;
  readonly hasCurrent: boolean;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly initial?: HealthInitial;
}) {
  if (!open) return null;
  const title = hasCurrent ? "Editar health del cliente" : "Cargar health del cliente";
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      subtitle={clientName}
      width={520}
    >
      <HealthFormBody
        clientId={clientId}
        onClose={onClose}
        initial={initial}
      />
    </Drawer>
  );
}

function HealthFormBody({
  clientId,
  onClose,
  initial,
}: {
  readonly clientId: string;
  readonly onClose: () => void;
  readonly initial?: HealthInitial;
}) {
  const boundAction = useMemo(
    () =>
      async (prev: UpsertHealthState, fd: FormData) =>
        upsertProjectHealth(clientId, prev, fd),
    [clientId],
  );

  const [state, formAction, pending] = useActionState<UpsertHealthState, FormData>(
    boundAction,
    null,
  );

  useEffect(() => {
    if (state && "ok" in state && state.ok) onClose();
  }, [state, onClose]);

  const [status, setStatus] = useState<RelationshipStatus>(
    initial?.relationshipStatus ?? "activa",
  );

  // El input date usa YMD local. Si initial.lastContactAt viene como ISO
  // con tiempo, extraemos la parte de fecha.
  const initialDate = initial?.lastContactAt
    ? initial.lastContactAt.slice(0, 10)
    : "";

  const activeHint = STATUS_OPTIONS.find((o) => o.value === status)?.hint ?? "";

  return (
    <form
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <Field label="Estado de la relación" htmlFor="relationship_status" required>
        <select
          id="relationship_status"
          name="relationship_status"
          value={status}
          onChange={(e) => setStatus(e.target.value as RelationshipStatus)}
          style={inputStyle}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginTop: 6 }}
        >
          {activeHint}
        </div>
      </Field>

      <Field label="Health score (opcional)" htmlFor="health_score">
        <input
          id="health_score"
          name="health_score"
          type="number"
          min={0}
          max={100}
          step={1}
          defaultValue={initial?.healthScore ?? ""}
          placeholder="Vacío = se calcula solo (cuando esté la fórmula compuesta)"
          style={inputStyle}
        />
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginTop: 6 }}
        >
          Override manual de 0 a 100. Dejalo vacío para que se derive de NPS + contacto + tickets urgentes cuando el selector esté conectado.
        </div>
      </Field>

      <Field label="Último contacto" htmlFor="last_contact_at">
        <input
          id="last_contact_at"
          name="last_contact_at"
          type="date"
          defaultValue={initialDate}
          style={inputStyle}
        />
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginTop: 6 }}
        >
          Última reunión, llamada, mensaje relevante. Alimenta la métrica de días sin contacto del health compuesto.
        </div>
      </Field>

      <Field label="Notas" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={initial?.notes ?? ""}
          placeholder="Contexto libre del estado de la relación"
          style={{ ...inputStyle, resize: "vertical", minHeight: 72 }}
        />
      </Field>

      {state && "error" in state && (
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
          {state.error}
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
          type="submit"
          disabled={pending}
          className="kg-focus"
          style={{ ...primaryBtn, opacity: pending ? 0.7 : 1 }}
        >
          {pending ? "Guardando…" : "Guardar health"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  readonly label: string;
  readonly htmlFor: string;
  readonly required?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="kg-t7"
        style={{ display: "block", color: "var(--kg-text-3)", marginBottom: 6 }}
      >
        {label}
        {required && (
          <span aria-hidden="true" style={{ color: "#EF4444", marginLeft: 4 }}>
            *
          </span>
        )}
      </label>
      {children}
    </div>
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
