"use client";

import {
  useActionState,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";

import { Drawer } from "@/components/kg/drawer";

import {
  createClass,
  deleteClass,
  updateClass,
  type CreateClassState,
  type UpdateClassState,
} from "./actions";

export interface ClassInitial {
  readonly id: string;
  readonly cohortId: string;
  readonly scheduledAtIso: string;
  readonly topic: string | null;
  readonly notes: string | null;
}

export function ClassFormDrawer({
  mode,
  open,
  onClose,
  cohortId,
  cohortName,
  initial,
}: {
  readonly mode: "create" | "edit";
  readonly open: boolean;
  readonly onClose: () => void;
  readonly cohortId: string;
  readonly cohortName: string;
  readonly initial?: ClassInitial;
}) {
  if (!open) return null;
  const title = mode === "create" ? "Nueva clase" : "Editar clase";
  return (
    <Drawer open={open} onClose={onClose} title={title} subtitle={cohortName} width={520}>
      <ClassFormBody
        mode={mode}
        cohortId={cohortId}
        initial={initial}
        onClose={onClose}
      />
    </Drawer>
  );
}

function ClassFormBody({
  mode,
  cohortId,
  initial,
  onClose,
}: {
  readonly mode: "create" | "edit";
  readonly cohortId: string;
  readonly initial?: ClassInitial;
  readonly onClose: () => void;
}) {
  const isEdit = mode === "edit" && initial != null;

  const updateBound = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id;
    return async (prev: UpdateClassState, fd: FormData) =>
      updateClass(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createFormAction, createPending] = useActionState<
    CreateClassState,
    FormData
  >(createClass, null);
  const [updateState, updateFormAction, updatePending] = useActionState<
    UpdateClassState,
    FormData
  >(
    updateBound ??
      (async () => ({ error: "Modo edit sin id" as string }) as never),
    null,
  );

  const state = isEdit ? updateState : createState;
  const formAction = isEdit ? updateFormAction : createFormAction;
  const pending = isEdit ? updatePending : createPending;

  useEffect(() => {
    if (state && "ok" in state && state.ok) onClose();
  }, [state, onClose]);

  const [scheduledLocal, setScheduledLocal] = useState<string>(
    initial ? isoToLocalDatetime(initial.scheduledAtIso) : defaultLocalDatetime(),
  );

  const [deletePending, startDeleteTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function handleDelete() {
    if (!isEdit || !initial) return;
    const ok = window.confirm(
      "¿Eliminar la clase? Se pierde la asistencia registrada para esa clase.",
    );
    if (!ok) return;
    setDeleteError(null);
    startDeleteTransition(async () => {
      const result = await deleteClass(initial.id);
      if ("error" in result) {
        setDeleteError(result.error);
        return;
      }
      onClose();
    });
  }

  return (
    <form
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <input type="hidden" name="cohort_id" value={cohortId} />
      {/* El input datetime-local guarda YYYY-MM-DDTHH:MM (sin timezone).
          Convertimos a ISO UTC via new Date().toISOString() antes de mandar
          para que el server no dependa del timezone del proceso. */}
      <input
        type="hidden"
        name="scheduled_at_iso"
        value={
          scheduledLocal
            ? new Date(scheduledLocal).toISOString()
            : ""
        }
      />

      <Field label="Fecha y hora" htmlFor="scheduled_local" required>
        <input
          id="scheduled_local"
          type="datetime-local"
          required
          value={scheduledLocal}
          onChange={(e) => setScheduledLocal(e.target.value)}
          style={inputStyle}
        />
      </Field>

      <Field label="Tema" htmlFor="topic">
        <input
          id="topic"
          name="topic"
          type="text"
          maxLength={300}
          defaultValue={initial?.topic ?? ""}
          placeholder="Ej. Módulo 3 · Fundamentos"
          style={inputStyle}
        />
      </Field>

      <Field label="Notas" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={initial?.notes ?? ""}
          placeholder="Contenido, materiales, links, etc."
          style={{ ...inputStyle, resize: "vertical", minHeight: 72 }}
        />
      </Field>

      {state && "error" in state && <ErrorBanner text={state.error} />}
      {deleteError && <ErrorBanner text={deleteError} />}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          marginTop: 4,
        }}
      >
        {isEdit ? (
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending || deletePending}
            className="kg-focus"
            style={{ ...dangerBtn, opacity: deletePending ? 0.7 : 1 }}
          >
            {deletePending ? "Eliminando…" : "Eliminar clase"}
          </button>
        ) : (
          <div />
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={pending || deletePending}
            className="kg-focus"
            style={secondaryBtn}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={pending || deletePending}
            className="kg-focus"
            style={{ ...primaryBtn, opacity: pending ? 0.7 : 1 }}
          >
            {pending
              ? isEdit
                ? "Guardando…"
                : "Creando…"
              : isEdit
                ? "Guardar cambios"
                : "Crear clase"}
          </button>
        </div>
      </div>
    </form>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers datetime.
//
// El input `datetime-local` usa el formato YYYY-MM-DDTHH:MM interpretado
// como local time del browser. Cuando la clase vuelve del server viene
// como ISO UTC — hay que convertir a local para que el input muestre la
// misma hora que el usuario ingresó.
// ═══════════════════════════════════════════════════════════════════════════
function isoToLocalDatetime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultLocalDatetime(): string {
  const d = new Date();
  // Redondear al próximo cuarto de hora hacia arriba, útil como default
  // razonable ("nueva clase" suele ser algo cercano al ahora).
  d.setSeconds(0, 0);
  const mins = d.getMinutes();
  const next = Math.ceil(mins / 15) * 15;
  d.setMinutes(next);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ErrorBanner({ text }: { readonly text: string }) {
  return (
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
      {text}
    </div>
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

const dangerBtn: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid #EF4444",
  color: "#EF4444",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
};
