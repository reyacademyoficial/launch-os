"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { StatusPill } from "@/components/kg/status-pill";

import {
  createExternalAppAction,
  deleteExternalAppAction,
  updateExternalAppAction,
  type UpsertExternalAppState,
} from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// CRUD de external_apps (Fase G · 0153 + simplificado 0156).
//
// Solo capturamos nombre, URL base, proyecto y estado activo. El botón del
// detalle del curso abre `base_url` en nueva pestaña — no hay SSO.
// ═══════════════════════════════════════════════════════════════════════════

export interface ProjectOption {
  readonly id: string;
  readonly name: string;
}

export interface AppRow {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly active: boolean;
}

export function AppsExternasView({
  rows,
  projectOptions,
}: {
  readonly rows: readonly AppRow[];
  readonly projectOptions: readonly ProjectOption[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

  const editing =
    editingId != null ? rows.find((r) => r.id === editingId) ?? null : null;

  const columns: Column<AppRow>[] = [
    {
      key: "name",
      label: "App",
      render: (r) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span
            style={{
              color: "var(--kg-text-1)",
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            {r.name}
          </span>
          <span
            className="kg-t7"
            style={{ color: "var(--kg-text-3)" }}
          >
            {r.baseUrl}
          </span>
        </div>
      ),
    },
    {
      key: "project",
      label: "Proyecto",
      render: (r) => (
        <span style={{ color: "var(--kg-text-2)", fontSize: 12 }}>
          {r.projectName}
        </span>
      ),
    },
    {
      key: "status",
      label: "Estado",
      render: (r) => (
        <StatusPill
          text={r.active ? "Activa" : "Inactiva"}
          tone={
            r.active ? "var(--kg-positive-500)" : "var(--kg-neutral-500)"
          }
        />
      ),
    },
    {
      key: "actions",
      label: "",
      align: "right",
      render: (r) => (
        <button
          type="button"
          onClick={() => setEditingId(r.id)}
          className="kg-focus"
          style={rowBtn}
        >
          Editar
        </button>
      ),
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="kg-t7"
        style={{
          color: "var(--kg-text-3)",
          lineHeight: 1.55,
          padding: "12px 20px",
          borderBottom: "1px solid var(--kg-border-subtle)",
          flexShrink: 0,
        }}
      >
        Apps externas del ecosistema (ej: Nitro tiene una app de agenda de
        turnos con expertos). El link app↔curso se hace desde el formulario
        del curso (campo &ldquo;App externa&rdquo;). El botón del curso abre
        la URL en nueva pestaña.
      </div>

      <KgDataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        totalCount={rows.length}
        emptyTitle="Sin apps externas"
        emptyHint="No hay apps externas registradas. Creá la primera para vincular un curso con una plataforma externa."
        fillHeight
      />

      {editing && (
        <AppFormOverlay
          mode="edit"
          projectOptions={projectOptions}
          initial={editing}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}

export function AppFormOverlay({
  mode,
  initial,
  projectOptions,
  onClose,
}: {
  readonly mode: "create" | "edit";
  readonly initial?: AppRow;
  readonly projectOptions: readonly ProjectOption[];
  readonly onClose: () => void;
}) {
  const isEdit = mode === "edit" && initial != null;

  const boundCreate = useMemo(
    () => async (prev: UpsertExternalAppState, fd: FormData) =>
      createExternalAppAction(prev, fd),
    [],
  );
  const boundUpdate = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id;
    return async (prev: UpsertExternalAppState, fd: FormData) =>
      updateExternalAppAction(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createAction, createPending] = useActionState<
    UpsertExternalAppState,
    FormData
  >(boundCreate, null);
  const [updateState, updateAction, updatePending] = useActionState<
    UpsertExternalAppState,
    FormData
  >(
    boundUpdate ??
      (async () => ({ error: "Modo edit sin id" as string }) as never),
    null,
  );

  const state = isEdit ? updateState : createState;
  const formAction = isEdit ? updateAction : createAction;
  const pending = isEdit ? updatePending : createPending;

  const [deletePending, startDeleteTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (state && "ok" in state && state.ok) onClose();
  }, [state, onClose]);

  function handleDelete() {
    if (!isEdit || !initial) return;
    const ok = window.confirm(
      `¿Eliminar la app "${initial.name}"? Los cursos que la usaban quedarán sin app asociada.`,
    );
    if (!ok) return;
    setDeleteError(null);
    startDeleteTransition(async () => {
      const result = await deleteExternalAppAction(initial.id);
      if ("error" in result) {
        setDeleteError(result.error);
        return;
      }
      onClose();
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
        overflowY: "auto",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 520,
          background: "var(--kg-surface-1-solid)",
          border: "1px solid var(--kg-border-subtle)",
          borderRadius: "var(--kg-r-12)",
          padding: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 14,
          }}
        >
          <div
            style={{
              color: "var(--kg-text-1)",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            {isEdit ? "Editar app externa" : "Nueva app externa"}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="kg-focus"
            aria-label="Cerrar"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--kg-text-3)",
              fontSize: 18,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>

        <form
          action={formAction}
          style={{ display: "flex", flexDirection: "column", gap: 14 }}
        >
          {!isEdit && (
            <Field label="Proyecto" htmlFor="project_id" required>
              <select
                id="project_id"
                name="project_id"
                required
                defaultValue=""
                style={inputStyle}
              >
                <option value="" disabled>
                  — Elegí un proyecto —
                </option>
                {projectOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="Nombre" htmlFor="name" required>
            <input
              id="name"
              name="name"
              type="text"
              required
              maxLength={120}
              defaultValue={initial?.name ?? ""}
              placeholder="Ej. Nitro Agenda"
              style={inputStyle}
            />
          </Field>

          <Field label="URL de la app" htmlFor="base_url" required>
            <input
              id="base_url"
              name="base_url"
              type="url"
              required
              defaultValue={initial?.baseUrl ?? ""}
              placeholder="https://agenda.nitro.reyacademy.com"
              style={inputStyle}
            />
          </Field>

          {isEdit && (
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                color: "var(--kg-text-2)",
                fontSize: 12,
              }}
            >
              <input
                type="checkbox"
                name="active"
                defaultChecked={initial?.active ?? true}
              />
              Activa
            </label>
          )}

          {state && "error" in state && <ErrorBanner text={state.error} />}
          {deleteError && <ErrorBanner text={deleteError} />}

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
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
                {deletePending ? "Eliminando…" : "Eliminar"}
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
                    ? "Guardar"
                    : "Crear"}
              </button>
            </div>
          </div>
        </form>
      </div>
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

const rowBtn: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
};
