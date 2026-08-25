"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";

import { Drawer } from "@/components/kg/drawer";
import {
  ErrorBanner,
  Field,
  dangerBtn,
  inputStyle,
  primaryBtn,
  secondaryBtn,
  smallBtn,
} from "@/components/kg/form-primitives";
import {
  createSession,
  deleteSession,
  updateSession,
  type CreateSessionState,
  type UpdateSessionState,
} from "@/app/(app)/(kg)/marketing/grabacion/actions";
import {
  RECORDING_ROLES,
  ROLE_LABEL,
  type RecordingRole,
} from "@/lib/marketing/types";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer create/edit de recording_session. Reusable cross-ruta:
//
//   - /marketing/grabacion (nueva sesión desde cero o edit)
//   - /marketing/planificacion (pre-cargado con piece + fecha desde una
//     content_piece en stage='planificado' — botón "Programar grabación")
//   - /marketing/grabacion panel "Pieces sin sesión" (pre-cargado con
//     conjunto de piezas del mismo owner+día)
//
// El submit sincroniza 3 cosas en una sola action:
//   - session (fields fijos)
//   - assignees (multi filas persona + rol; el drawer permite +/- filas)
//   - pieces asociadas (checkboxes de content_pieces filtradas por owner)
//
// PRESET: en modo 'create', `initial` puede llegar con owner + scheduledAt +
// pieceIds pre-poblados. `initialKey` sirve para forzar remount del body
// cuando el preset cambia (ej: abrir el drawer desde otra piece).
// ═══════════════════════════════════════════════════════════════════════════

export interface OwnerOption {
  readonly id: string;
  readonly name: string;
}

export interface PersonOption {
  readonly id: string;
  readonly fullName: string;
}

export interface PieceOption {
  readonly id: string;
  readonly title: string;
  readonly contentOwnerId: string;
  readonly stage: string;
  /** id de la sesión donde ya está asociada (o null si libre). */
  readonly recordingSessionId: string | null;
}

export interface SessionInitial {
  /** Sólo en modo edit. */
  readonly id?: string;
  readonly contentOwnerId?: string;
  readonly scheduledAt?: string;
  readonly durationMinutes?: number | null;
  readonly location?: string | null;
  readonly materials?: string | null;
  readonly notes?: string | null;
  readonly assignees?: readonly {
    readonly personId: string;
    readonly role: RecordingRole;
  }[];
  readonly pieceIds?: readonly string[];
}

export function SessionFormDrawer({
  mode,
  open,
  onClose,
  ownerOptions,
  personOptions,
  pieceOptions,
  initial,
  initialKey,
}: {
  readonly mode: "create" | "edit";
  readonly open: boolean;
  readonly onClose: () => void;
  readonly ownerOptions: readonly OwnerOption[];
  readonly personOptions: readonly PersonOption[];
  readonly pieceOptions: readonly PieceOption[];
  readonly initial?: SessionInitial;
  /**
   * Cambiar este valor entre aperturas fuerza remount del body — usar
   * cuando el mismo drawer se reabre con un preset distinto (ej: click en
   * otra piece "Programar grabación").
   */
  readonly initialKey?: string;
}) {
  if (!open) return null;
  const title = mode === "create" ? "Nueva grabación" : "Editar grabación";
  return (
    <Drawer open={open} onClose={onClose} title={title} width={640}>
      <SessionFormBody
        key={initialKey ?? initial?.id ?? "create"}
        mode={mode}
        onClose={onClose}
        ownerOptions={ownerOptions}
        personOptions={personOptions}
        pieceOptions={pieceOptions}
        initial={initial}
      />
    </Drawer>
  );
}

interface AssigneeRow {
  readonly key: string;
  readonly personId: string;
  readonly role: RecordingRole;
}

function SessionFormBody({
  mode,
  onClose,
  ownerOptions,
  personOptions,
  pieceOptions,
  initial,
}: {
  readonly mode: "create" | "edit";
  readonly onClose: () => void;
  readonly ownerOptions: readonly OwnerOption[];
  readonly personOptions: readonly PersonOption[];
  readonly pieceOptions: readonly PieceOption[];
  readonly initial?: SessionInitial;
}) {
  const isEdit = mode === "edit" && initial?.id != null;

  const updateBound = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id!;
    return async (prev: UpdateSessionState, fd: FormData) =>
      updateSession(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createFormAction, createPending] = useActionState<
    CreateSessionState,
    FormData
  >(createSession, null);
  const [updateState, updateFormAction, updatePending] = useActionState<
    UpdateSessionState,
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
  const [assignees, setAssignees] = useState<AssigneeRow[]>(() => {
    const src = initial?.assignees ?? [];
    return src.map((a, i) => ({
      key: `${a.personId}-${a.role}-${i}`,
      personId: a.personId,
      role: a.role,
    }));
  });
  const [selectedPieceIds, setSelectedPieceIds] = useState<Set<string>>(
    () => new Set(initial?.pieceIds ?? []),
  );

  const [deletePending, startDeleteTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Pieces filtradas por owner seleccionado + libres (o ya asociadas a esta
  // session). Excluímos pieces asociadas a OTRA session — hay que desatarlas
  // primero desde su session origen.
  const availablePieces = useMemo(() => {
    if (!ownerId) return [];
    return pieceOptions.filter(
      (p) =>
        p.contentOwnerId === ownerId &&
        (p.recordingSessionId == null ||
          (initial?.id != null && p.recordingSessionId === initial.id)),
    );
  }, [ownerId, pieceOptions, initial]);

  function handleOwnerChange(nextOwner: string) {
    setOwnerId(nextOwner);
    if (nextOwner !== ownerId) setSelectedPieceIds(new Set());
  }

  function addAssignee() {
    setAssignees((prev) => [
      ...prev,
      { key: `new-${Date.now()}-${prev.length}`, personId: "", role: "filmaker" },
    ]);
  }

  function removeAssignee(key: string) {
    setAssignees((prev) => prev.filter((a) => a.key !== key));
  }

  function updateAssignee(key: string, patch: Partial<AssigneeRow>) {
    setAssignees((prev) =>
      prev.map((a) => (a.key === key ? { ...a, ...patch } : a)),
    );
  }

  function togglePiece(id: string) {
    setSelectedPieceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleDelete() {
    if (!isEdit || !initial?.id) return;
    const ok = window.confirm(
      "¿Eliminar la sesión definitivamente? Las pieces asociadas quedan desatadas (no se borran) y conservan el stage al que hayan llegado.",
    );
    if (!ok) return;
    setDeleteError(null);
    startDeleteTransition(async () => {
      const result = await deleteSession(initial.id!);
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

      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 2 }}>
          <Field label="Fecha y hora" htmlFor="scheduled_at" required>
            <input
              id="scheduled_at"
              name="scheduled_at"
              type="datetime-local"
              required
              defaultValue={toDatetimeLocal(initial?.scheduledAt)}
              style={inputStyle}
            />
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Duración (min)" htmlFor="duration_minutes">
            <input
              id="duration_minutes"
              name="duration_minutes"
              type="number"
              min={1}
              defaultValue={initial?.durationMinutes ?? ""}
              placeholder="60"
              style={inputStyle}
            />
          </Field>
        </div>
      </div>

      <Field label="Ubicación" htmlFor="location">
        <input
          id="location"
          name="location"
          type="text"
          defaultValue={initial?.location ?? ""}
          placeholder="Estudio, oficina, remoto, etc."
          style={inputStyle}
        />
      </Field>

      <Field label="Materiales" htmlFor="materials">
        <textarea
          id="materials"
          name="materials"
          rows={2}
          defaultValue={initial?.materials ?? ""}
          placeholder="Cámara, luces, atril, props especiales..."
          style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
        />
      </Field>

      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 6,
          }}
        >
          <span className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
            Personas asignadas
          </span>
          <button
            type="button"
            onClick={addAssignee}
            className="kg-focus"
            style={smallBtn}
          >
            + Agregar
          </button>
        </div>
        {assignees.length === 0 ? (
          <EmptyHint text="Sin personas asignadas. Agregá filmaker y experto al menos." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {assignees.map((a) => (
              <div
                key={a.key}
                style={{ display: "flex", gap: 8, alignItems: "flex-end" }}
              >
                <div style={{ flex: 2 }}>
                  <select
                    name="assignee_person_id"
                    value={a.personId}
                    onChange={(e) =>
                      updateAssignee(a.key, { personId: e.target.value })
                    }
                    required
                    style={inputStyle}
                    aria-label="Persona"
                  >
                    <option value="">— Persona —</option>
                    {personOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.fullName}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <select
                    name="assignee_role"
                    value={a.role}
                    onChange={(e) =>
                      updateAssignee(a.key, {
                        role: e.target.value as RecordingRole,
                      })
                    }
                    required
                    style={inputStyle}
                    aria-label="Rol"
                  >
                    {RECORDING_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => removeAssignee(a.key)}
                  className="kg-focus"
                  style={{
                    ...smallBtn,
                    borderColor: "#EF4444",
                    color: "#EF4444",
                  }}
                  title="Quitar"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginBottom: 6 }}
        >
          Content pieces asociadas
        </div>
        {!ownerId ? (
          <EmptyHint text="Elegí un dueño arriba para ver sus pieces disponibles." />
        ) : availablePieces.length === 0 ? (
          <EmptyHint text="Este dueño no tiene pieces libres. Creá algunas en Planificación." />
        ) : (
          <div
            style={{
              maxHeight: 220,
              overflowY: "auto",
              padding: 4,
              border: "1px solid var(--kg-border-subtle)",
              borderRadius: "var(--kg-r-8)",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {availablePieces.map((p) => {
              const checked = selectedPieceIds.has(p.id);
              return (
                <label
                  key={p.id}
                  htmlFor={`piece_${p.id}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 10px",
                    borderRadius: "var(--kg-r-8)",
                    background: checked
                      ? "var(--kg-surface-2-solid)"
                      : "transparent",
                    cursor: "pointer",
                    fontSize: 12,
                    color: "var(--kg-text-1)",
                  }}
                >
                  <input
                    id={`piece_${p.id}`}
                    type="checkbox"
                    checked={checked}
                    onChange={() => togglePiece(p.id)}
                    style={{ cursor: "pointer" }}
                  />
                  {p.title}
                </label>
              );
            })}
          </div>
        )}
        {Array.from(selectedPieceIds).map((id) => (
          <input key={id} type="hidden" name="piece_ids" value={id} />
        ))}
      </div>

      <Field label="Notas" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={2}
          defaultValue={initial?.notes ?? ""}
          placeholder="Contexto libre — link a Meet, notas del experto, etc."
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
            title="Elimina la sesión (las pieces quedan desatadas)"
          >
            {deletePending ? "Eliminando…" : "Eliminar sesión"}
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
                : "Crear sesión"}
          </button>
        </div>
      </div>
    </form>
  );
}

function EmptyHint({ text }: { readonly text: string }) {
  return (
    <div
      className="kg-t7"
      style={{
        padding: "10px 14px",
        borderRadius: "var(--kg-r-8)",
        background: "var(--kg-surface-2-solid)",
        border: "1px dashed var(--kg-border-subtle)",
        color: "var(--kg-text-3)",
        textAlign: "center",
      }}
    >
      {text}
    </div>
  );
}

function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
