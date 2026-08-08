"use client";

import { useActionState, useEffect, useMemo, useState } from "react";

import { Drawer } from "@/components/kg/drawer";
import { classifyNps } from "@/lib/clients/health";

import {
  createNps,
  updateNps,
  type CreateNpsState,
  type UpdateNpsState,
} from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer para crear o editar una respuesta NPS.
//
// El score es required 0-10. La clasificación (promoter/passive/detractor)
// se calcula en vivo mientras el operador tipea, para dar feedback
// inmediato del bucket resultante.
// ═══════════════════════════════════════════════════════════════════════════

export interface ClientOptionForNps {
  readonly id: string;
  readonly name: string;
}

export interface NpsInitial {
  readonly id: string;
  readonly clientId: string;
  readonly respondentName: string | null;
  readonly respondentEmail: string | null;
  readonly score: number;
  readonly comment: string | null;
  readonly channel: string | null;
  /** ISO — el drawer extrae la parte YMD para el date input. */
  readonly respondedAt: string;
}

const BUCKET_LABEL: Record<
  "promoter" | "passive" | "detractor",
  string
> = {
  promoter: "Promotor",
  passive: "Pasivo",
  detractor: "Detractor",
};

const BUCKET_COLOR: Record<
  "promoter" | "passive" | "detractor",
  string
> = {
  promoter: "var(--kg-positive-500)",
  passive: "var(--kg-warning-500)",
  detractor: "var(--kg-negative-500)",
};

export function NpsFormDrawer({
  mode,
  open,
  onClose,
  clients,
  initial,
  presetClientId,
}: {
  readonly mode: "create" | "edit";
  readonly open: boolean;
  readonly onClose: () => void;
  readonly clients: readonly ClientOptionForNps[];
  readonly initial?: NpsInitial;
  readonly presetClientId?: string | null;
}) {
  if (!open) return null;
  const title = mode === "create" ? "Nueva respuesta NPS" : "Editar respuesta NPS";
  return (
    <Drawer open={open} onClose={onClose} title={title} width={520}>
      <NpsFormBody
        mode={mode}
        clients={clients}
        initial={initial}
        presetClientId={presetClientId}
        onClose={onClose}
      />
    </Drawer>
  );
}

function NpsFormBody({
  mode,
  clients,
  initial,
  presetClientId,
  onClose,
}: {
  readonly mode: "create" | "edit";
  readonly clients: readonly ClientOptionForNps[];
  readonly initial?: NpsInitial;
  readonly presetClientId?: string | null;
  readonly onClose: () => void;
}) {
  const isEdit = mode === "edit" && initial != null;

  const updateBound = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id;
    return async (prev: UpdateNpsState, fd: FormData) =>
      updateNps(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createFormAction, createPending] = useActionState<
    CreateNpsState,
    FormData
  >(createNps, null);
  const [updateState, updateFormAction, updatePending] = useActionState<
    UpdateNpsState,
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

  const [score, setScore] = useState<string>(
    initial?.score != null ? String(initial.score) : "",
  );

  if (clients.length === 0) {
    return (
      <div style={{ padding: 8 }}>
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", lineHeight: 1.55 }}
        >
          No hay clientes activos cargados. Andá a{" "}
          <a
            href="/clientes"
            style={{ color: "var(--kg-accent-500)" }}
          >
            Clientes
          </a>{" "}
          para dar de alta al menos uno antes de cargar respuestas NPS.
        </div>
      </div>
    );
  }

  const initialClientId =
    initial?.clientId ?? presetClientId ?? clients[0]?.id ?? "";

  const scoreNum = Number(score);
  const bucketPreview =
    Number.isFinite(scoreNum) && scoreNum >= 0 && scoreNum <= 10
      ? classifyNps(Math.round(scoreNum))
      : null;

  // Extraemos la fecha YMD del ISO para el date input.
  const initialDate = initial?.respondedAt
    ? initial.respondedAt.slice(0, 10)
    : todayYmd();

  return (
    <form
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <Field label="Cliente" htmlFor="client_id" required>
        <select
          id="client_id"
          name="client_id"
          defaultValue={initialClientId}
          required
          style={inputStyle}
        >
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
        <Field label="Score (0-10)" htmlFor="score" required>
          <input
            id="score"
            name="score"
            type="number"
            min={0}
            max={10}
            step={1}
            required
            value={score}
            onChange={(e) => setScore(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Clasificación" htmlFor="__bucket_preview">
          <div
            id="__bucket_preview"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "9px 12px",
              borderRadius: "var(--kg-r-8)",
              background: "var(--kg-surface-2-solid)",
              border: "1px solid var(--kg-border-subtle)",
              fontSize: 13,
              color: bucketPreview
                ? "var(--kg-text-1)"
                : "var(--kg-text-3)",
              minHeight: 38,
            }}
          >
            {bucketPreview ? (
              <>
                <span
                  aria-hidden
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: BUCKET_COLOR[bucketPreview],
                    flexShrink: 0,
                  }}
                />
                {BUCKET_LABEL[bucketPreview]}
                <span style={{ color: "var(--kg-text-3)", fontSize: 11 }}>
                  {bucketPreview === "promoter"
                    ? "· 9-10"
                    : bucketPreview === "passive"
                      ? "· 7-8"
                      : "· 0-6"}
                </span>
              </>
            ) : (
              "Cargá un score válido"
            )}
          </div>
        </Field>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Nombre del respondente" htmlFor="respondent_name">
          <input
            id="respondent_name"
            name="respondent_name"
            type="text"
            defaultValue={initial?.respondentName ?? ""}
            placeholder="Opcional"
            style={inputStyle}
          />
        </Field>
        <Field label="Email" htmlFor="respondent_email">
          <input
            id="respondent_email"
            name="respondent_email"
            type="email"
            defaultValue={initial?.respondentEmail ?? ""}
            placeholder="Opcional"
            style={inputStyle}
          />
        </Field>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Canal" htmlFor="channel">
          <input
            id="channel"
            name="channel"
            type="text"
            defaultValue={initial?.channel ?? ""}
            placeholder="Ej. email, reunión, form"
            style={inputStyle}
          />
        </Field>
        <Field label="Fecha de la respuesta" htmlFor="responded_at">
          <input
            id="responded_at"
            name="responded_at"
            type="date"
            defaultValue={initialDate}
            style={inputStyle}
          />
        </Field>
      </div>

      <Field label="Comentario" htmlFor="comment">
        <textarea
          id="comment"
          name="comment"
          rows={3}
          defaultValue={initial?.comment ?? ""}
          placeholder="Lo que dijo el respondente. Es el 80% del valor cualitativo del NPS."
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
          {pending
            ? isEdit
              ? "Guardando…"
              : "Creando…"
            : isEdit
              ? "Guardar cambios"
              : "Crear respuesta"}
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

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
