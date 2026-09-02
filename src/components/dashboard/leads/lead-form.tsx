"use client";

import { useActionState, useEffect, type CSSProperties } from "react";

import type { LeadActionState } from "@/app/(app)/(kg)/proyectos/[projectId]/leads/actions";
import {
  ErrorBanner,
  Field,
  inputStyle,
  primaryBtn,
} from "@/components/kg/form-primitives";
import { LEAD_STATUSES, LEAD_STATUS_LABELS, type LeadRow } from "@/lib/leads/types";
import type { TeamMemberRow } from "@/lib/team/types";

type FormState = LeadActionState;
type FormAction = (prev: FormState, formData: FormData) => Promise<FormState>;

/**
 * `inputStyle` da ~38px de alto con su padding 9/12, pero los `<select>` y
 * `<textarea>` nativos calculan el alto con la fuente del sistema y en
 * algunos browsers de Android caen por debajo del target de toque. Fijamos
 * 36 explícito — misma decisión que en `launches/launch-form.tsx`.
 */
const controlStyle: CSSProperties = { ...inputStyle, minHeight: 36 };

/**
 * Los `<select>` de este form van NATIVOS a propósito, no con
 * `KgFilterSelect`: ese componente navega con `router.push(href)` y no emite
 * ningún valor al `FormData` del submit. Acá el form postea a un server
 * action, así que status / asignado / lanzamiento tienen que ser controles
 * reales con `name`.
 */
export function LeadForm({
  action,
  initial,
  submitLabel,
  onSuccess,
  teamMembers,
  launches,
}: {
  readonly action: FormAction;
  readonly initial?: LeadRow;
  readonly submitLabel: string;
  readonly onSuccess?: () => void;
  readonly teamMembers: ReadonlyArray<Pick<TeamMemberRow, "id" | "name" | "active">>;
  readonly launches: ReadonlyArray<{ id: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);

  useEffect(() => {
    if (state && "ok" in state && state.ok) onSuccess?.();
  }, [state, onSuccess]);

  // Fallback: si el lead apunta a un team_member que ya no está activo, igual
  // lo dejamos en el select para no perder la asignación.
  const showInactiveAssignee =
    initial?.team_member_id !== null &&
    initial?.team_member_id !== undefined &&
    !teamMembers.some((t) => t.id === initial.team_member_id);

  // Traza de evergreen: si el lead llegó por reciclado, mostramos de qué
  // launch vino (read-only — la traza no es editable).
  const recycledFromName = initial?.recycled_from_launch_id
    ? launches.find((l) => l.id === initial.recycled_from_launch_id)?.name ?? null
    : null;

  return (
    <form
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      {recycledFromName && (
        // Aviso informativo, no un estado del dato: caja neutra con el borde
        // de acento. No usamos ErrorBanner porque no es un error ni un dato
        // incompleto — es procedencia.
        <div
          className="kg-t7"
          style={{
            padding: "10px 14px",
            borderRadius: "var(--kg-r-8)",
            background: "var(--kg-accent-halo)",
            border: "1px solid var(--kg-border-subtle)",
            color: "var(--kg-text-2)",
            lineHeight: 1.5,
          }}
        >
          ↩ Reciclado desde el evergreen{" "}
          <b style={{ color: "var(--kg-text-1)" }}>{recycledFromName}</b>
        </div>
      )}

      <Field label="Nombre" htmlFor="lead-name" required>
        <input
          id="lead-name"
          name="name"
          required
          defaultValue={initial?.name ?? ""}
          placeholder="Ej: Juan Pérez"
          style={controlStyle}
        />
      </Field>

      <Field label="Contacto (tel / email)" htmlFor="lead-contact">
        <input
          id="lead-contact"
          name="contact"
          defaultValue={initial?.contact ?? ""}
          placeholder="+54 911… o juan@…"
          style={controlStyle}
        />
      </Field>

      {/* Mobile primero: una columna en 390px, 2 recién en md+. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Status" htmlFor="lead-status">
          <select
            id="lead-status"
            name="status"
            defaultValue={initial?.status ?? "nuevo"}
            style={controlStyle}
          >
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {LEAD_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Asignado a" htmlFor="lead-assignee">
          <select
            id="lead-assignee"
            name="team_member_id"
            defaultValue={initial?.team_member_id ?? ""}
            style={controlStyle}
          >
            <option value="">— Sin asignar —</option>
            {teamMembers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {!t.active ? " (inactivo)" : ""}
              </option>
            ))}
            {showInactiveAssignee && initial?.team_member_id && (
              <option value={initial.team_member_id}>(asignación anterior)</option>
            )}
          </select>
        </Field>
      </div>

      <Field label="Lanzamiento (opcional)" htmlFor="lead-launch">
        <select
          id="lead-launch"
          name="launch_id"
          defaultValue={initial?.launch_id ?? ""}
          style={controlStyle}
        >
          <option value="">— Sin asociar —</option>
          {launches.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Notas" htmlFor="lead-notes">
        <textarea
          id="lead-notes"
          name="notes"
          rows={3}
          defaultValue={initial?.notes ?? ""}
          placeholder="Origen, contexto, próximos pasos…"
          style={{ ...controlStyle, resize: "vertical", lineHeight: 1.5 }}
        />
      </Field>

      {/* El error va arriba del botón y a ancho completo: en 390px el layout
          viejo (error al lado del submit) lo empujaba fuera de la vista. */}
      {state && "error" in state && <ErrorBanner message={state.error} />}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="submit"
          disabled={pending}
          className="kg-focus w-full md:w-auto"
          style={{
            ...primaryBtn,
            minHeight: 40,
            opacity: pending ? 0.7 : 1,
            cursor: pending ? "not-allowed" : "pointer",
          }}
        >
          {pending ? "Guardando…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
