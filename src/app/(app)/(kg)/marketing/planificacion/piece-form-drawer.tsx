"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";

import { Drawer } from "@/components/kg/drawer";
import {
  CATEGORY_LABEL,
  FORMAT_LABEL,
  MARKETING_CATEGORIES,
  MARKETING_FORMATS,
  MARKETING_PLATFORMS,
  PLATFORM_LABEL,
  type MarketingCategory,
  type MarketingFormat,
  type MarketingPlatform,
} from "@/lib/marketing/types";

import {
  createPiece,
  deletePiece,
  updatePiece,
  type CreatePieceState,
  type UpdatePieceState,
} from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer para crear o editar una content_piece.
//
// Layout: 2 columnas para pickers cortos (owner/category/format, fechas),
// full-width para title, script_md (grande) y notas. Platforms como grid de
// 4 checkboxes.
//
// El toggle "eliminar" solo aparece en edit sobre pieces que la action
// deletePiece va a aceptar (stage=planificado + sin recording_session_id).
// Los demás casos deben usar "descartar" desde la vista tabla.
// ═══════════════════════════════════════════════════════════════════════════

export interface PieceInitial {
  readonly id: string;
  readonly contentOwnerId: string;
  readonly title: string;
  readonly scriptMd: string | null;
  readonly category: MarketingCategory;
  readonly format: MarketingFormat;
  readonly platforms: readonly MarketingPlatform[];
  readonly scheduledRecordingAt: string | null;
  readonly scheduledPublishAt: string | null;
  readonly isDailyRecurring: boolean;
  readonly notes: string | null;
  /** Sirve para decidir si el botón "Eliminar" del drawer aparece. */
  readonly canHardDelete: boolean;
}

export interface OwnerOption {
  readonly id: string;
  readonly name: string;
}

export function PieceFormDrawer({
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
  readonly initial?: PieceInitial;
}) {
  if (!open) return null;
  const title = mode === "create" ? "Nuevo contenido planificado" : "Editar planificación";
  return (
    <Drawer open={open} onClose={onClose} title={title} width={620}>
      <PieceFormBody
        mode={mode}
        onClose={onClose}
        ownerOptions={ownerOptions}
        initial={initial}
      />
    </Drawer>
  );
}

function PieceFormBody({
  mode,
  onClose,
  ownerOptions,
  initial,
}: {
  readonly mode: "create" | "edit";
  readonly onClose: () => void;
  readonly ownerOptions: readonly OwnerOption[];
  readonly initial?: PieceInitial;
}) {
  const isEdit = mode === "edit" && initial != null;

  const updateBound = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id;
    return async (prev: UpdatePieceState, fd: FormData) =>
      updatePiece(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createFormAction, createPending] = useActionState<
    CreatePieceState,
    FormData
  >(createPiece, null);
  const [updateState, updateFormAction, updatePending] = useActionState<
    UpdatePieceState,
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

  const [platforms, setPlatforms] = useState<Set<MarketingPlatform>>(() => {
    return new Set(initial?.platforms ?? []);
  });
  const [isDaily, setIsDaily] = useState(initial?.isDailyRecurring ?? false);
  const [deletePending, startDeleteTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function togglePlatform(p: MarketingPlatform) {
    setPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  function handleDelete() {
    if (!isEdit || !initial) return;
    const ok = window.confirm(
      `¿Eliminar la planificación "${initial.title}" definitivamente? ` +
        "Solo se puede eliminar si aún está en estado planificado sin sesión asignada. Si no, usá 'Descartar'.",
    );
    if (!ok) return;
    setDeleteError(null);
    startDeleteTransition(async () => {
      const result = await deletePiece(initial.id);
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
      <Field label="Título" htmlFor="title" required>
        <input
          id="title"
          name="title"
          type="text"
          required
          maxLength={200}
          defaultValue={initial?.title ?? ""}
          placeholder="Ej. Cómo salir del monotributo — nugget IG"
          style={inputStyle}
          autoFocus
        />
      </Field>

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
          <Field label="Categoría" htmlFor="category" required>
            <select
              id="category"
              name="category"
              required
              defaultValue={initial?.category ?? ""}
              style={inputStyle}
            >
              <option value="">— Elegí —</option>
              {MARKETING_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
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

      <Field label="Plataformas destino" htmlFor="platforms_grid" required>
        <div
          id="platforms_grid"
          role="group"
          aria-label="Plataformas destino"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 8,
          }}
        >
          {MARKETING_PLATFORMS.map((p) => {
            const checked = platforms.has(p);
            return (
              <label
                key={p}
                htmlFor={`plat_${p}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                  borderRadius: "var(--kg-r-8)",
                  background: "var(--kg-surface-2-solid)",
                  border: `1px solid ${
                    checked ? "var(--kg-accent-500)" : "var(--kg-border-subtle)"
                  }`,
                  cursor: "pointer",
                  fontSize: 12,
                  color: "var(--kg-text-1)",
                }}
              >
                <input
                  id={`plat_${p}`}
                  type="checkbox"
                  name="platforms"
                  value={p}
                  checked={checked}
                  onChange={() => togglePlatform(p)}
                  style={{ cursor: "pointer" }}
                />
                {PLATFORM_LABEL[p]}
              </label>
            );
          })}
        </div>
      </Field>

      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <Field label="Grabación planificada" htmlFor="scheduled_recording_at">
            <input
              id="scheduled_recording_at"
              name="scheduled_recording_at"
              type="datetime-local"
              defaultValue={toDatetimeLocal(initial?.scheduledRecordingAt)}
              style={inputStyle}
            />
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Publicación planificada" htmlFor="scheduled_publish_at">
            <input
              id="scheduled_publish_at"
              name="scheduled_publish_at"
              type="date"
              defaultValue={initial?.scheduledPublishAt ?? ""}
              style={inputStyle}
            />
          </Field>
        </div>
      </div>

      <Field label="Guión" htmlFor="script_md">
        <textarea
          id="script_md"
          name="script_md"
          rows={7}
          defaultValue={initial?.scriptMd ?? ""}
          placeholder="Guión de la grabación. Markdown liviano: **negrita**, listas, ganchos, etc."
          style={{ ...inputStyle, resize: "vertical", minHeight: 140 }}
        />
      </Field>

      <label
        htmlFor="is_daily_toggle"
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
          id="is_daily_toggle"
          type="checkbox"
          checked={isDaily}
          onChange={(e) => setIsDaily(e.target.checked)}
          style={{ cursor: "pointer" }}
        />
        <div style={{ flex: 1 }}>
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-1)", fontWeight: 600 }}
          >
            Tarea diaria (se regenera al publicar)
          </div>
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-3)", marginTop: 2 }}
          >
            Cuando el piece pase a publicado, se clona automáticamente con
            fecha de publicación del día siguiente y stage=planificado. El
            flag se hereda. Sirve para contenido diario tipo &ldquo;nugget del día&rdquo;.
          </div>
        </div>
      </label>

      <input
        type="hidden"
        name="is_daily_recurring"
        value={isDaily ? "on" : "off"}
      />

      <Field label="Notas" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={2}
          defaultValue={initial?.notes ?? ""}
          placeholder="Contexto libre — hook, referencias, quién es el experto sugerido, etc."
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
        {isEdit && initial?.canHardDelete ? (
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending || deletePending}
            className="kg-focus"
            style={{ ...dangerBtn, opacity: deletePending ? 0.7 : 1 }}
            title="Elimina definitivamente (solo si aún está planificado y sin sesión)"
          >
            {deletePending ? "Eliminando…" : "Eliminar planificación"}
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
                : "Crear planificación"}
          </button>
        </div>
      </div>
    </form>
  );
}

/**
 * Convierte un ISO timestamptz (o null) al formato aceptado por
 * `<input type="datetime-local">`: "YYYY-MM-DDTHH:mm". Se recorta a minutos.
 */
function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
