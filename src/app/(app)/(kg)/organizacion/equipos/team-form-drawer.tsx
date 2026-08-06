"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";

import { Drawer } from "@/components/kg/drawer";

import {
  createTeam,
  deleteTeam,
  updateTeam,
  type CreateTeamState,
  type UpdateTeamState,
} from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer para crear/editar un equipo.
//
// El checkbox "Activo" solo aparece en edit (los nuevos nacen activos).
// Delete button en el edit con confirm + guard duro server-side.
// ═══════════════════════════════════════════════════════════════════════════

export interface TeamInitial {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly active: boolean;
}

export function TeamFormDrawer({
  mode,
  open,
  onClose,
  initial,
}: {
  readonly mode: "create" | "edit";
  readonly open: boolean;
  readonly onClose: () => void;
  readonly initial?: TeamInitial;
}) {
  if (!open) return null;
  const title = mode === "create" ? "Nuevo equipo" : "Editar equipo";
  return (
    <Drawer open={open} onClose={onClose} title={title} width={520}>
      <TeamFormBody mode={mode} initial={initial} onClose={onClose} />
    </Drawer>
  );
}

function TeamFormBody({
  mode,
  initial,
  onClose,
}: {
  readonly mode: "create" | "edit";
  readonly initial?: TeamInitial;
  readonly onClose: () => void;
}) {
  const isEdit = mode === "edit" && initial != null;

  const updateBound = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id;
    return async (prev: UpdateTeamState, fd: FormData) =>
      updateTeam(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createFormAction, createPending] = useActionState<
    CreateTeamState,
    FormData
  >(createTeam, null);
  const [updateState, updateFormAction, updatePending] = useActionState<
    UpdateTeamState,
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
      `¿Eliminar el equipo "${initial.name}"? Esta acción no se puede deshacer. Si tiene historial de membresías va a rebotar — usá "Archivar" (destildar Activo) en su lugar.`,
    );
    if (!ok) return;
    setDeleteError(null);
    startDeleteTransition(async () => {
      const result = await deleteTeam(initial.id);
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
      <Field label="Nombre" htmlFor="name" required>
        <input
          id="name"
          name="name"
          type="text"
          required
          maxLength={200}
          defaultValue={initial?.name ?? ""}
          placeholder="Ej. Producto, Growth, Media Buying"
          style={inputStyle}
          autoFocus
        />
      </Field>

      <Field label="Descripción" htmlFor="description">
        <textarea
          id="description"
          name="description"
          rows={2}
          defaultValue={initial?.description ?? ""}
          placeholder="Alcance del equipo (opcional)"
          style={{ ...inputStyle, resize: "vertical", minHeight: 56 }}
        />
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
                Equipo activo
              </div>
              <div
                className="kg-t7"
                style={{ color: "var(--kg-text-3)", marginTop: 2 }}
              >
                Los archivados no aparecen en filtros ni sirven para
                sumar personas nuevas. Su historial de membresías se
                preserva.
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
            title="Elimina el equipo (solo si no tiene historial de membresías)"
          >
            {deletePending ? "Eliminando…" : "Eliminar equipo"}
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
                : "Crear equipo"}
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
