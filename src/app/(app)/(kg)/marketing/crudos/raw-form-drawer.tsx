"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";

import { Drawer } from "@/components/kg/drawer";
import {
  dangerBtn,
  ErrorBanner,
  Field,
  inputStyle,
  primaryBtn,
  secondaryBtn,
} from "@/components/kg/form-primitives";

import {
  createRaw,
  deleteRaw,
  updateRaw,
  type CreateRawState,
  type UpdateRawState,
} from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer create/edit de content_raw (Crudos).
//
// Owner primero → filtra el picker de sesión. Sesión es opcional siempre —
// un crudo puede cargarse suelto.
//
// `lockOrigin`: cuando se abre desde la fila de una sesión `realizada` en
// /marketing/grabacion ("Cargar crudos"), owner y sesión vienen fijos y no
// se pueden tocar — mismo patrón que `presetSessionId` en el batch drawer
// que reemplaza este componente. El usuario ajusta nombre + link.
// ═══════════════════════════════════════════════════════════════════════════

export interface OwnerOption {
  readonly id: string;
  readonly name: string;
}

export interface SessionOption {
  readonly id: string;
  readonly contentOwnerId: string;
  readonly label: string;
}

export interface RawInitial {
  readonly id: string;
  readonly contentOwnerId: string;
  readonly sourceRecordingSessionId: string | null;
  readonly name: string;
  readonly driveUrl: string;
  readonly notes: string | null;
}

export function RawFormDrawer({
  mode,
  open,
  onClose,
  ownerOptions,
  sessionOptions,
  initial,
  lockOrigin,
  initialKey,
}: {
  readonly mode: "create" | "edit";
  readonly open: boolean;
  readonly onClose: () => void;
  readonly ownerOptions: readonly OwnerOption[];
  readonly sessionOptions: readonly SessionOption[];
  readonly initial?: RawInitial;
  /** Owner + sesión vienen fijos (alta rápida desde una sesión realizada). */
  readonly lockOrigin?: boolean;
  /** Cambiar fuerza remount — usar cuando se reabre con otro preset. */
  readonly initialKey?: string;
}) {
  if (!open) return null;
  const title = mode === "create" ? "Nuevo crudo" : "Editar crudo";
  return (
    <Drawer open={open} onClose={onClose} title={title} width={560}>
      <RawFormBody
        key={initialKey}
        mode={mode}
        onClose={onClose}
        ownerOptions={ownerOptions}
        sessionOptions={sessionOptions}
        initial={initial}
        lockOrigin={lockOrigin}
      />
    </Drawer>
  );
}

function RawFormBody({
  mode,
  onClose,
  ownerOptions,
  sessionOptions,
  initial,
  lockOrigin,
}: {
  readonly mode: "create" | "edit";
  readonly onClose: () => void;
  readonly ownerOptions: readonly OwnerOption[];
  readonly sessionOptions: readonly SessionOption[];
  readonly initial?: RawInitial;
  readonly lockOrigin?: boolean;
}) {
  const isEdit = mode === "edit" && initial != null;

  const updateBound = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id;
    return async (prev: UpdateRawState, fd: FormData) => updateRaw(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createFormAction, createPending] = useActionState<
    CreateRawState,
    FormData
  >(createRaw, null);
  const [updateState, updateFormAction, updatePending] = useActionState<
    UpdateRawState,
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

  const [deletePending, startDeleteTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const availableSessions = useMemo(
    () =>
      ownerId ? sessionOptions.filter((s) => s.contentOwnerId === ownerId) : [],
    [ownerId, sessionOptions],
  );

  function handleOwnerChange(next: string) {
    setOwnerId(next);
    if (next !== ownerId) setSessionId("");
  }

  function handleDelete() {
    if (!isEdit || !initial) return;
    const ok = window.confirm("¿Eliminar el crudo definitivamente?");
    if (!ok) return;
    setDeleteError(null);
    startDeleteTransition(async () => {
      const result = await deleteRaw(initial.id);
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
          disabled={lockOrigin}
          style={{ ...inputStyle, opacity: lockOrigin ? 0.75 : 1 }}
        >
          <option value="">— Elegí un dueño —</option>
          {ownerOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Sesión de grabación"
        htmlFor="source_recording_session_id"
        hint="Opcional — un crudo puede cargarse suelto, sin sesión registrada."
      >
        <select
          id="source_recording_session_id"
          name="source_recording_session_id"
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          disabled={!ownerId || lockOrigin}
          style={{ ...inputStyle, opacity: lockOrigin ? 0.75 : 1 }}
        >
          <option value="">— Sin sesión —</option>
          {availableSessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Nombre" htmlFor="name" required>
        <input
          id="name"
          name="name"
          type="text"
          required
          maxLength={200}
          defaultValue={initial?.name ?? ""}
          placeholder="Cámara A - apertura"
          style={inputStyle}
        />
      </Field>

      <Field label="Link al crudo" htmlFor="drive_url" required>
        <input
          id="drive_url"
          name="drive_url"
          type="url"
          required
          defaultValue={initial?.driveUrl ?? ""}
          placeholder="https://drive.google.com/drive/folders/..."
          style={inputStyle}
        />
      </Field>

      <Field label="Notas" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={2}
          defaultValue={initial?.notes ?? ""}
          placeholder="Contexto libre — qué cámara, qué se grabó, etc."
          style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
        />
      </Field>

      {state && "error" in state && <ErrorBanner message={state.error} />}
      {deleteError && <ErrorBanner message={deleteError} />}

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
            {deletePending ? "Eliminando…" : "Eliminar crudo"}
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
                : "Crear crudo"}
          </button>
        </div>
      </div>
    </form>
  );
}
