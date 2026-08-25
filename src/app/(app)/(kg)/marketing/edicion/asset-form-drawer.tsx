"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";

import { Drawer } from "@/components/kg/drawer";
import {
  FORMAT_LABEL,
  MARKETING_FORMATS,
  type MarketingFormat,
} from "@/lib/marketing/types";

import {
  createAsset,
  deleteAsset,
  updateAsset,
  type CreateAssetState,
  type UpdateAssetState,
} from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer create/edit de content_asset.
//
// Lógica clave:
//   - Owner elegido primero → filtra sesiones y pieces del picker.
//   - Sesión / piece son opcionales (asset huérfano permitido, ej. import).
//   - Elegir una session pre-carga automáticamente el owner (si el usuario
//     no lo tocó todavía).
//   - Checkbox "Marcar como editado" muestra un datetime-local con default
//     "ahora". Setear edited_at dispara trigger 0162 que avanza el piece
//     origen a `listo_para_subir`.
// ═══════════════════════════════════════════════════════════════════════════

export interface OwnerOption {
  readonly id: string;
  readonly name: string;
}

export interface PersonOption {
  readonly id: string;
  readonly fullName: string;
}

export interface SessionOption {
  readonly id: string;
  readonly contentOwnerId: string;
  readonly label: string; // "24/08 · Rey Academy" — legible en el select
}

export interface PieceOption {
  readonly id: string;
  readonly contentOwnerId: string;
  readonly title: string;
  readonly recordingSessionId: string | null;
}

export interface AssetInitial {
  readonly id: string;
  readonly contentOwnerId: string;
  readonly sourceRecordingSessionId: string | null;
  readonly sourceContentPieceId: string | null;
  readonly name: string;
  readonly format: MarketingFormat;
  readonly driveFolderUrl: string | null;
  readonly driveAssetUrl: string | null;
  readonly durationSeconds: number | null;
  readonly editorPersonId: string | null;
  readonly editedAt: string | null;
  readonly notes: string | null;
}

export function AssetFormDrawer({
  mode,
  open,
  onClose,
  ownerOptions,
  personOptions,
  sessionOptions,
  pieceOptions,
  initial,
}: {
  readonly mode: "create" | "edit";
  readonly open: boolean;
  readonly onClose: () => void;
  readonly ownerOptions: readonly OwnerOption[];
  readonly personOptions: readonly PersonOption[];
  readonly sessionOptions: readonly SessionOption[];
  readonly pieceOptions: readonly PieceOption[];
  readonly initial?: AssetInitial;
}) {
  if (!open) return null;
  const title = mode === "create" ? "Nuevo asset editado" : "Editar asset";
  return (
    <Drawer open={open} onClose={onClose} title={title} width={620}>
      <AssetFormBody
        mode={mode}
        onClose={onClose}
        ownerOptions={ownerOptions}
        personOptions={personOptions}
        sessionOptions={sessionOptions}
        pieceOptions={pieceOptions}
        initial={initial}
      />
    </Drawer>
  );
}

function AssetFormBody({
  mode,
  onClose,
  ownerOptions,
  personOptions,
  sessionOptions,
  pieceOptions,
  initial,
}: {
  readonly mode: "create" | "edit";
  readonly onClose: () => void;
  readonly ownerOptions: readonly OwnerOption[];
  readonly personOptions: readonly PersonOption[];
  readonly sessionOptions: readonly SessionOption[];
  readonly pieceOptions: readonly PieceOption[];
  readonly initial?: AssetInitial;
}) {
  const isEdit = mode === "edit" && initial != null;

  const updateBound = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id;
    return async (prev: UpdateAssetState, fd: FormData) =>
      updateAsset(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createFormAction, createPending] = useActionState<
    CreateAssetState,
    FormData
  >(createAsset, null);
  const [updateState, updateFormAction, updatePending] = useActionState<
    UpdateAssetState,
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

  const [ownerId, setOwnerId] = useState(initial?.contentOwnerId ?? "");
  const [sessionId, setSessionId] = useState(
    initial?.sourceRecordingSessionId ?? "",
  );
  const [pieceId, setPieceId] = useState(
    initial?.sourceContentPieceId ?? "",
  );
  const [markEdited, setMarkEdited] = useState(initial?.editedAt != null);

  const [deletePending, startDeleteTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const availableSessions = useMemo(
    () =>
      ownerId
        ? sessionOptions.filter((s) => s.contentOwnerId === ownerId)
        : [],
    [ownerId, sessionOptions],
  );

  const availablePieces = useMemo(
    () =>
      ownerId
        ? pieceOptions.filter((p) => p.contentOwnerId === ownerId)
        : [],
    [ownerId, pieceOptions],
  );

  function handleOwnerChange(next: string) {
    setOwnerId(next);
    if (next !== ownerId) {
      setSessionId("");
      setPieceId("");
    }
  }

  function handleSessionChange(next: string) {
    setSessionId(next);
    if (next && !ownerId) {
      const s = sessionOptions.find((so) => so.id === next);
      if (s) setOwnerId(s.contentOwnerId);
    }
  }

  function handlePieceChange(next: string) {
    setPieceId(next);
    if (next) {
      const p = pieceOptions.find((po) => po.id === next);
      if (p && !ownerId) setOwnerId(p.contentOwnerId);
      // Si el piece tiene una session asociada, la pre-cargamos.
      if (p?.recordingSessionId && !sessionId) {
        setSessionId(p.recordingSessionId);
      }
    }
  }

  function handleDelete() {
    if (!isEdit || !initial) return;
    const ok = window.confirm(
      "¿Eliminar el asset definitivamente? Si tiene subidas asociadas se va a rebotar.",
    );
    if (!ok) return;
    setDeleteError(null);
    startDeleteTransition(async () => {
      const result = await deleteAsset(initial.id);
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
          value={ownerId}
          onChange={(e) => handleOwnerChange(e.target.value)}
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

      <Field label="Nombre del asset" htmlFor="name" required>
        <input
          id="name"
          name="name"
          type="text"
          required
          maxLength={200}
          defaultValue={initial?.name ?? ""}
          placeholder="reel_042_apertura"
          style={inputStyle}
        />
      </Field>

      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <Field label="Formato" htmlFor="format" required>
            <select
              id="format"
              name="format"
              required
              defaultValue={initial?.format ?? "reel"}
              style={inputStyle}
            >
              {MARKETING_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {FORMAT_LABEL[f]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Duración (s)" htmlFor="duration_seconds">
            <input
              id="duration_seconds"
              name="duration_seconds"
              type="number"
              min={1}
              defaultValue={initial?.durationSeconds ?? ""}
              placeholder="30"
              style={inputStyle}
            />
          </Field>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <Field label="Sesión origen" htmlFor="source_recording_session_id">
            <select
              id="source_recording_session_id"
              name="source_recording_session_id"
              value={sessionId}
              onChange={(e) => handleSessionChange(e.target.value)}
              disabled={!ownerId}
              style={inputStyle}
            >
              <option value="">— Sin sesión —</option>
              {availableSessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Piece origen" htmlFor="source_content_piece_id">
            <select
              id="source_content_piece_id"
              name="source_content_piece_id"
              value={pieceId}
              onChange={(e) => handlePieceChange(e.target.value)}
              disabled={!ownerId}
              style={inputStyle}
            >
              <option value="">— Sin piece asignada —</option>
              {availablePieces.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      <Field label="Editor a cargo" htmlFor="editor_person_id">
        <select
          id="editor_person_id"
          name="editor_person_id"
          defaultValue={initial?.editorPersonId ?? ""}
          style={inputStyle}
        >
          <option value="">— Sin asignar —</option>
          {personOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.fullName}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Link a carpeta (Drive, Dropbox, Frame.io)" htmlFor="drive_folder_url">
        <input
          id="drive_folder_url"
          name="drive_folder_url"
          type="url"
          defaultValue={initial?.driveFolderUrl ?? ""}
          placeholder="https://drive.google.com/drive/folders/..."
          style={inputStyle}
        />
      </Field>

      <Field label="Link al archivo específico" htmlFor="drive_asset_url">
        <input
          id="drive_asset_url"
          name="drive_asset_url"
          type="url"
          defaultValue={initial?.driveAssetUrl ?? ""}
          placeholder="https://drive.google.com/file/d/..."
          style={inputStyle}
        />
      </Field>

      <div
        style={{
          padding: "12px 14px",
          borderRadius: "var(--kg-r-8)",
          background: "var(--kg-surface-2-solid)",
          border: "1px solid var(--kg-border-subtle)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
            fontSize: 12,
            color: "var(--kg-text-1)",
            fontWeight: 600,
          }}
        >
          <input
            type="checkbox"
            name="mark_edited"
            checked={markEdited}
            onChange={(e) => setMarkEdited(e.target.checked)}
            style={{ cursor: "pointer" }}
          />
          Asset editado
        </label>
        <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
          Marcar como editado avanza la piece origen a &quot;Listo para subir&quot;
          (si estaba en Edición). Podés dejarlo sin marcar mientras está en
          cola.
        </div>
        {markEdited && (
          <div>
            <label
              htmlFor="edited_at_manual"
              className="kg-t7"
              style={{
                display: "block",
                color: "var(--kg-text-3)",
                marginBottom: 6,
              }}
            >
              Fecha de edición
            </label>
            <input
              id="edited_at_manual"
              name="edited_at_manual"
              type="datetime-local"
              defaultValue={toDatetimeLocal(initial?.editedAt) || defaultNowLocal()}
              style={inputStyle}
            />
          </div>
        )}
      </div>

      <Field label="Notas" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={2}
          defaultValue={initial?.notes ?? ""}
          placeholder="Contexto libre — corte alternativo, versión con subtítulos, etc."
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
            title="Eliminar el asset (falla si tiene subidas asociadas)"
          >
            {deletePending ? "Eliminando…" : "Eliminar asset"}
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
                : "Crear asset"}
          </button>
        </div>
      </div>
    </form>
  );
}

function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultNowLocal(): string {
  const d = new Date();
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
