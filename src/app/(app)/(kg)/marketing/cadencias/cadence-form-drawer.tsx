"use client";

import { useActionState, useEffect, useState, useTransition } from "react";

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
  upsertCadence,
  type CreateCadenceState,
} from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer para crear o editar una cadencia (owner × platform × format).
//
// Modo create: los 3 campos del key son editables + pickers.
// Modo edit: los 3 campos van bloqueados (readOnly); cambiar la triada
// requiere eliminar + crear de nuevo. Editar acá cambia posts_per_day,
// allow_repeat_asset y notes.
// ═══════════════════════════════════════════════════════════════════════════

export interface CadenceInitial {
  readonly contentOwnerId: string;
  readonly platform: MarketingPlatform;
  readonly format: MarketingFormat;
  readonly postsPerDay: number;
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

  const [state, formAction, pending] = useActionState<
    CreateCadenceState,
    FormData
  >(upsertCadence, null);

  useEffect(() => {
    if (state && "ok" in state && state.ok) onClose();
  }, [state, onClose]);

  const [allowRepeat, setAllowRepeat] = useState(
    initial?.allowRepeatAsset ?? false,
  );
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
          disabled={isEdit}
          style={inputStyle}
        >
          {!isEdit && <option value="">— Elegí un dueño —</option>}
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
              disabled={isEdit}
              style={inputStyle}
            >
              {!isEdit && <option value="">— Elegí —</option>}
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
              disabled={isEdit}
              style={inputStyle}
            >
              {!isEdit && <option value="">— Elegí —</option>}
              {MARKETING_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {FORMAT_LABEL[f]}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      {/* Cuando editamos, los pickers están disabled — los valores no viajan
          en el submit. Los reenviamos por hidden inputs para que el upsert
          matchee la fila correcta por PK compuesta. */}
      {isEdit && initial && (
        <>
          <input
            type="hidden"
            name="content_owner_id"
            value={initial.contentOwnerId}
          />
          <input type="hidden" name="platform" value={initial.platform} />
          <input type="hidden" name="format" value={initial.format} />
        </>
      )}

      <Field label="Posts por día" htmlFor="posts_per_day" required>
        <input
          id="posts_per_day"
          name="posts_per_day"
          type="number"
          min={1}
          max={100}
          required
          defaultValue={initial?.postsPerDay ?? 1}
          style={inputStyle}
        />
      </Field>

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
