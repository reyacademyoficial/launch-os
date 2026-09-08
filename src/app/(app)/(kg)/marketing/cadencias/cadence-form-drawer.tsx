"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";

import { Drawer } from "@/components/kg/drawer";
import {
  FORMAT_LABEL,
  MARKETING_FORMATS,
  MARKETING_PLATFORMS,
  PLATFORM_LABEL,
  type MarketingFormat,
  type MarketingPlatform,
} from "@/lib/marketing/types";

import {
  deleteCadence,
  updateCadence,
  upsertCadence,
  type CreateCadenceState,
  type UpdateCadenceState,
} from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer para crear o editar una cadencia (owner × platform × format).
//
// Modo create: `upsertCadence` — los 3 campos del key son editables.
// Modo edit: `updateCadence` — los 3 campos TAMBIÉN son editables (se puede
// mover la cadencia a otro dueño/plataforma/formato); la fila se identifica
// por su clave ORIGINAL (capturada en `initial`), no por lo que el usuario
// tipee en el formulario.
// ═══════════════════════════════════════════════════════════════════════════

const PRESETS: readonly { label: string; timesCount: number; periodDays: number }[] = [
  { label: "Diario", timesCount: 1, periodDays: 1 },
  { label: "Día por medio", timesCount: 1, periodDays: 2 },
  { label: "3x/semana", timesCount: 3, periodDays: 7 },
  { label: "Semanal", timesCount: 1, periodDays: 7 },
];

export interface CadenceInitial {
  readonly contentOwnerId: string;
  readonly platform: MarketingPlatform;
  readonly format: MarketingFormat;
  readonly timesCount: number;
  readonly periodDays: number;
  readonly allowRepeatAsset: boolean;
  readonly notes: string | null;
}

export interface OwnerOption {
  readonly id: string;
  readonly name: string;
}

export function CadenceFormDrawer({
  mode,
  open,
  onClose,
  ownerOptions,
  initial,
}: {
  readonly mode: "create" | "edit";
  readonly open: boolean;
  readonly onClose: () => void;
  readonly ownerOptions: readonly OwnerOption[];
  readonly initial?: CadenceInitial;
}) {
  if (!open) return null;
  const title = mode === "create" ? "Nueva cadencia" : "Editar cadencia";
  return (
    <Drawer open={open} onClose={onClose} title={title} width={520}>
      <CadenceFormBody
        mode={mode}
        onClose={onClose}
        ownerOptions={ownerOptions}
        initial={initial}
      />
    </Drawer>
  );
}

function CadenceFormBody({
  mode,
  onClose,
  ownerOptions,
  initial,
}: {
  readonly mode: "create" | "edit";
  readonly onClose: () => void;
  readonly ownerOptions: readonly OwnerOption[];
  readonly initial?: CadenceInitial;
}) {
  const isEdit = mode === "edit" && initial != null;

  const updateBound = useMemo(() => {
    if (!isEdit || !initial) return null;
    const { contentOwnerId, platform, format } = initial;
    return async (prev: UpdateCadenceState, fd: FormData) =>
      updateCadence(contentOwnerId, platform, format, prev, fd);
  }, [isEdit, initial]);

  const [createState, createFormAction, createPending] = useActionState<
    CreateCadenceState,
    FormData
  >(upsertCadence, null);
  const [updateState, updateFormAction, updatePending] = useActionState<
    UpdateCadenceState,
    FormData
  >(
    updateBound ??
      (async () => ({ error: "Modo edit sin datos" as string }) as never),
    null,
  );

  const state = isEdit ? updateState : createState;
  const formAction = isEdit ? updateFormAction : createFormAction;
  const pending = isEdit ? updatePending : createPending;

  useEffect(() => {
    if (state && "ok" in state && state.ok) onClose();
  }, [state, onClose]);

  const [allowRepeat, setAllowRepeat] = useState(
    initial?.allowRepeatAsset ?? false,
  );
  // String, no number — con `Number(...) || 1` en el onChange, borrar el
  // campo para tipear un valor nuevo pasaba por un instante en "" que el
  // fallback pisaba de vuelta a 1 antes de que el usuario pudiera terminar
  // de escribir (se sentía como "no me deja editar"). Guardamos el texto
  // crudo y sólo lo interpretamos para la preview de tasa/día — la
  // validación real (entero > 0) la hace el server action al submit.
  const [timesCount, setTimesCount] = useState(
    String(initial?.timesCount ?? 1),
  );
  const [periodDays, setPeriodDays] = useState(
    String(initial?.periodDays ?? 1),
  );
  const timesCountNum = Number.parseInt(timesCount, 10);
  const periodDaysNum = Number.parseInt(periodDays, 10);
  const dailyRate =
    Number.isFinite(timesCountNum) &&
    Number.isFinite(periodDaysNum) &&
    periodDaysNum > 0
      ? timesCountNum / periodDaysNum
      : 0;
  const [deletePending, startDeleteTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function handleDelete() {
    if (!isEdit || !initial) return;
    const ok = window.confirm(
      "¿Eliminar la cadencia? Sin cadencia no se puede calcular días de cobertura para este dueño en esta plataforma y formato.",
    );
    if (!ok) return;
    setDeleteError(null);
    startDeleteTransition(async () => {
      const result = await deleteCadence(
        initial.contentOwnerId,
        initial.platform,
        initial.format,
      );
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
      <Field label="Dueño de contenido" htmlFor="content_owner_id" required>
        <select
          id="content_owner_id"
          name="content_owner_id"
          required
          defaultValue={initial?.contentOwnerId ?? ""}
          style={inputStyle}
        >
          <option value="">— Elegí un dueño —</option>
          {ownerOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </Field>

      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <Field label="Plataforma" htmlFor="platform" required>
            <select
              id="platform"
              name="platform"
              required
              defaultValue={initial?.platform ?? ""}
              style={inputStyle}
            >
              <option value="">— Elegí —</option>
              {MARKETING_PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {PLATFORM_LABEL[p]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Formato" htmlFor="format" required>
            <select
              id="format"
              name="format"
              required
              defaultValue={initial?.format ?? ""}
              style={inputStyle}
            >
              <option value="">— Elegí —</option>
              {MARKETING_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {FORMAT_LABEL[f]}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      <div>
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginBottom: 6 }}
        >
          Ritmo de publicación
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                setTimesCount(String(p.timesCount));
                setPeriodDays(String(p.periodDays));
              }}
              className="kg-focus"
              style={presetBtn}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <Field label="Cantidad" htmlFor="times_count" required>
              <input
                id="times_count"
                name="times_count"
                type="number"
                min={1}
                max={100}
                required
                value={timesCount}
                onChange={(e) => setTimesCount(e.target.value)}
                style={inputStyle}
              />
            </Field>
          </div>
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-3)", paddingBottom: 10 }}
          >
            cada
          </div>
          <div style={{ flex: 1 }}>
            <Field label="Días" htmlFor="period_days" required>
              <input
                id="period_days"
                name="period_days"
                type="number"
                min={1}
                max={90}
                required
                value={periodDays}
                onChange={(e) => setPeriodDays(e.target.value)}
                style={inputStyle}
              />
            </Field>
          </div>
        </div>
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginTop: 6 }}
        >
          ≈ {dailyRate.toFixed(2)} posts/día
        </div>
      </div>

      <label
        htmlFor="allow_repeat_toggle"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          borderRadius: "var(--kg-r-8)",
          background: "var(--kg-surface-2-solid)",
          border: "1px solid var(--kg-border-subtle)",
          cursor: "pointer",
        }}
      >
        <input
          id="allow_repeat_toggle"
          type="checkbox"
          checked={allowRepeat}
          onChange={(e) => setAllowRepeat(e.target.checked)}
          style={{ cursor: "pointer" }}
        />
        <div style={{ flex: 1 }}>
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-1)", fontWeight: 600 }}
          >
            Permitir reciclar el mismo asset
          </div>
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-3)", marginTop: 2 }}
          >
            Si está apagado, un asset consumido por un upload sale del stock
            disponible para esta combinación. Si está prendido, un mismo asset
            puede volver a subirse (sirve para stories reutilizables).
          </div>
        </div>
      </label>

      <input
        type="hidden"
        name="allow_repeat_asset"
        value={allowRepeat ? "on" : "off"}
      />

      <Field label="Notas" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={2}
          defaultValue={initial?.notes ?? ""}
          placeholder="Contexto libre — horarios preferidos, tono, etc."
          style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
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

      {deleteError && (
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
          {deleteError}
        </div>
      )}

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
            title="Elimina la cadencia"
          >
            {deletePending ? "Eliminando…" : "Eliminar cadencia"}
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
              ? "Guardando…"
              : isEdit
                ? "Guardar cambios"
                : "Crear cadencia"}
          </button>
        </div>
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

const presetBtn: React.CSSProperties = {
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
