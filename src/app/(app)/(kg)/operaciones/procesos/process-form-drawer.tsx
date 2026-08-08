"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";

import { Drawer } from "@/components/kg/drawer";

import {
  createProcess,
  deleteProcess,
  updateProcess,
  type CreateProcessState,
  type UpdateProcessState,
} from "./actions";

export interface ProcessInitial {
  readonly id: string;
  readonly title: string;
  readonly slug: string | null;
  readonly contentMd: string;
  readonly category: string | null;
  readonly version: number;
  readonly active: boolean;
}

export function ProcessFormDrawer({
  mode,
  open,
  onClose,
  initial,
}: {
  readonly mode: "create" | "edit";
  readonly open: boolean;
  readonly onClose: () => void;
  readonly initial?: ProcessInitial;
}) {
  if (!open) return null;
  const title = mode === "create" ? "Nuevo proceso" : "Editar proceso";
  return (
    <Drawer open={open} onClose={onClose} title={title} width={720}>
      <ProcessFormBody mode={mode} initial={initial} onClose={onClose} />
    </Drawer>
  );
}

function ProcessFormBody({
  mode,
  initial,
  onClose,
}: {
  readonly mode: "create" | "edit";
  readonly initial?: ProcessInitial;
  readonly onClose: () => void;
}) {
  const isEdit = mode === "edit" && initial != null;

  const updateBound = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id;
    return async (prev: UpdateProcessState, fd: FormData) =>
      updateProcess(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createFormAction, createPending] = useActionState<
    CreateProcessState,
    FormData
  >(createProcess, null);
  const [updateState, updateFormAction, updatePending] = useActionState<
    UpdateProcessState,
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

  const [active, setActive] = useState(initial?.active ?? true);
  const [deletePending, startDeleteTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function handleDelete() {
    if (!isEdit || !initial) return;
    const ok = window.confirm(
      `¿Eliminar el proceso "${initial.title}"? Esta acción no se puede deshacer. Si preferís sacarlo de vista sin perderlo, archivalo destildando "Activo".`,
    );
    if (!ok) return;
    setDeleteError(null);
    startDeleteTransition(async () => {
      const result = await deleteProcess(initial.id);
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
          maxLength={300}
          defaultValue={initial?.title ?? ""}
          placeholder="Ej. Onboarding de closer nuevo"
          style={inputStyle}
          autoFocus
        />
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
        <Field label="Slug (opcional)" htmlFor="slug">
          <input
            id="slug"
            name="slug"
            type="text"
            defaultValue={initial?.slug ?? ""}
            placeholder="onboarding-closer"
            style={inputStyle}
          />
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-3)", marginTop: 6 }}
          >
            Solo lowercase, números y guiones. Para URLs amigables.
          </div>
        </Field>
        <Field label="Categoría" htmlFor="category">
          <input
            id="category"
            name="category"
            type="text"
            defaultValue={initial?.category ?? ""}
            placeholder="Ej. Ventas"
            style={inputStyle}
          />
        </Field>
        <Field label="Versión" htmlFor="version" required>
          <input
            id="version"
            name="version"
            type="number"
            min={1}
            step={1}
            required
            defaultValue={initial?.version ?? 1}
            style={inputStyle}
          />
        </Field>
      </div>

      <Field label="Contenido (Markdown)" htmlFor="content_md">
        <textarea
          id="content_md"
          name="content_md"
          rows={16}
          defaultValue={initial?.contentMd ?? ""}
          placeholder="# Título del proceso&#10;&#10;## Paso 1&#10;- Detalle&#10;- Detalle&#10;&#10;## Paso 2&#10;..."
          style={{
            ...inputStyle,
            resize: "vertical",
            minHeight: 320,
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
            fontSize: 12,
            lineHeight: 1.55,
          }}
        />
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginTop: 6 }}
        >
          Markdown estándar (headings, listas, código, links). Se renderiza
          en la ficha del proceso.
        </div>
      </Field>

      {isEdit && (
        <>
          <label
            htmlFor="__active_toggle"
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
              id="__active_toggle"
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              style={{ cursor: "pointer" }}
            />
            <div style={{ flex: 1 }}>
              <div
                className="kg-t7"
                style={{ color: "var(--kg-text-1)", fontWeight: 600 }}
              >
                Proceso activo
              </div>
              <div
                className="kg-t7"
                style={{ color: "var(--kg-text-3)", marginTop: 2 }}
              >
                Los archivados dejan de aparecer en el listado por default,
                pero se preservan por referencias históricas.
              </div>
            </div>
          </label>
          <input type="hidden" name="active" value={active ? "on" : "off"} />
        </>
      )}

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
            {deletePending ? "Eliminando…" : "Eliminar proceso"}
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
                : "Crear proceso"}
          </button>
        </div>
      </div>
    </form>
  );
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
