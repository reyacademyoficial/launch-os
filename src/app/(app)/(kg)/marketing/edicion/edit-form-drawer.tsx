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
  createContentEdit,
  deleteContentEdit,
  updateContentEdit,
  type CreateEditState,
  type UpdateEditState,
} from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer create/edit de content_edit — el evento de trabajo ("editar tal
// crudo"), no el archivo de salida. Owner primero → filtra el picker de
// crudos. Formato/duración/link viven en el drawer de cierre
// (complete-edit-drawer.tsx), no acá — eso es de cada archivo de salida.
// ═══════════════════════════════════════════════════════════════════════════

export interface OwnerOption {
  readonly id: string;
  readonly name: string;
}

export interface PersonOption {
  readonly id: string;
  readonly fullName: string;
}

export interface RawOption {
  readonly id: string;
  readonly contentOwnerId: string;
  readonly label: string;
}

export interface EditInitial {
  readonly id: string;
  readonly contentOwnerId: string;
  readonly sourceContentRawId: string | null;
  readonly title: string;
  readonly editorPersonId: string | null;
  readonly dueDate: string | null;
  readonly notes: string | null;
}

export function EditFormDrawer({
  mode,
  open,
  onClose,
  ownerOptions,
  personOptions,
  rawOptions,
  initial,
  presetOwnerId,
  presetRawId,
  initialKey,
}: {
  readonly mode: "create" | "edit";
  readonly open: boolean;
  readonly onClose: () => void;
  readonly ownerOptions: readonly OwnerOption[];
  readonly personOptions: readonly PersonOption[];
  readonly rawOptions: readonly RawOption[];
  readonly initial?: EditInitial;
  /** Alta rápida desde /marketing/crudos: owner + crudo pre-cargados. */
  readonly presetOwnerId?: string;
  readonly presetRawId?: string;
  readonly initialKey?: string;
}) {
  if (!open) return null;
  const title = mode === "create" ? "Nueva edición" : "Editar evento de edición";
  return (
    <Drawer open={open} onClose={onClose} title={title} width={560}>
      <EditFormBody
        key={initialKey}
        mode={mode}
        onClose={onClose}
        ownerOptions={ownerOptions}
        personOptions={personOptions}
        rawOptions={rawOptions}
        initial={initial}
        presetOwnerId={presetOwnerId}
        presetRawId={presetRawId}
      />
    </Drawer>
  );
}

function EditFormBody({
  mode,
  onClose,
  ownerOptions,
  personOptions,
  rawOptions,
  initial,
  presetOwnerId,
  presetRawId,
}: {
  readonly mode: "create" | "edit";
  readonly onClose: () => void;
  readonly ownerOptions: readonly OwnerOption[];
  readonly personOptions: readonly PersonOption[];
  readonly rawOptions: readonly RawOption[];
  readonly initial?: EditInitial;
  readonly presetOwnerId?: string;
  readonly presetRawId?: string;
}) {
  const isEdit = mode === "edit" && initial != null;

  const updateBound = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id;
    return async (prev: UpdateEditState, fd: FormData) =>
      updateContentEdit(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createFormAction, createPending] = useActionState<
    CreateEditState,
    FormData
  >(createContentEdit, null);
  const [updateState, updateFormAction, updatePending] = useActionState<
    UpdateEditState,
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

  const [ownerId, setOwnerId] = useState(
    initial?.contentOwnerId ?? presetOwnerId ?? "",
  );
  const [rawId, setRawId] = useState(
    initial?.sourceContentRawId ?? presetRawId ?? "",
  );

  const [deletePending, startDeleteTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const availableRaws = useMemo(
    () => (ownerId ? rawOptions.filter((r) => r.contentOwnerId === ownerId) : []),
    [ownerId, rawOptions],
  );

  function handleOwnerChange(next: string) {
    setOwnerId(next);
    if (next !== ownerId) setRawId("");
  }

  function handleDelete() {
    if (!isEdit || !initial) return;
    const ok = window.confirm(
      "¿Eliminar esta edición? Si ya produjo archivos, se va a rebotar.",
    );
    if (!ok) return;
    setDeleteError(null);
    startDeleteTransition(async () => {
      const result = await deleteContentEdit(initial.id);
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

      <Field
        label="Crudo a editar"
        htmlFor="source_content_raw_id"
        hint="Opcional — se puede crear la edición y elegir el crudo después."
      >
        <select
          id="source_content_raw_id"
          name="source_content_raw_id"
          value={rawId}
          onChange={(e) => setRawId(e.target.value)}
          disabled={!ownerId}
          style={inputStyle}
        >
          <option value="">— Sin crudo —</option>
          {availableRaws.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Título" htmlFor="title" required>
        <input
          id="title"
          name="title"
          type="text"
          required
          maxLength={200}
          defaultValue={initial?.title ?? ""}
          placeholder="Editar crudo sesión 24/08 — cortes reels"
          style={inputStyle}
        />
      </Field>

      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}>
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
        </div>
        <div style={{ flex: 1 }}>
          <Field
            label="Fecha objetivo"
            htmlFor="due_date"
            hint="Ubica la edición en el planning semanal."
          >
            <input
              id="due_date"
              name="due_date"
              type="date"
              defaultValue={initial?.dueDate ?? ""}
              style={inputStyle}
            />
          </Field>
        </div>
      </div>

      <Field label="Notas" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={2}
          defaultValue={initial?.notes ?? ""}
          placeholder="Contexto libre — qué cortes salen de acá, indicaciones, etc."
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
            title="Eliminar la edición (falla si ya produjo archivos)"
          >
            {deletePending ? "Eliminando…" : "Eliminar edición"}
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
                : "Crear edición"}
          </button>
        </div>
      </div>
    </form>
  );
}
