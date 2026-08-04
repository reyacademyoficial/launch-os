"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";

import { Drawer } from "@/components/kg/drawer";

import {
  createClient,
  deleteClient,
  updateClient,
  type CreateClientState,
  type UpdateClientState,
} from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer para crear o editar un cliente (empresa B2B externa).
//
// Modo create: form vacío, active se fuerza true (no aparece el checkbox).
// Modo edit: prepobla con `initial`, muestra checkbox de activo/archivado.
// ═══════════════════════════════════════════════════════════════════════════

export interface ClientInitial {
  readonly id: string;
  readonly name: string;
  readonly businessName: string | null;
  readonly industry: string | null;
  readonly notes: string | null;
  readonly active: boolean;
}

export function ClientFormDrawer({
  mode,
  open,
  onClose,
  initial,
}: {
  readonly mode: "create" | "edit";
  readonly open: boolean;
  readonly onClose: () => void;
  readonly initial?: ClientInitial;
}) {
  if (!open) return null;
  const title = mode === "create" ? "Nuevo cliente" : "Editar cliente";
  return (
    <Drawer open={open} onClose={onClose} title={title} width={520}>
      <ClientFormBody mode={mode} onClose={onClose} initial={initial} />
    </Drawer>
  );
}

function ClientFormBody({
  mode,
  onClose,
  initial,
}: {
  readonly mode: "create" | "edit";
  readonly onClose: () => void;
  readonly initial?: ClientInitial;
}) {
  const isEdit = mode === "edit" && initial != null;

  const updateBound = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id;
    return async (prev: UpdateClientState, fd: FormData) =>
      updateClient(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createFormAction, createPending] = useActionState<
    CreateClientState,
    FormData
  >(createClient, null);
  const [updateState, updateFormAction, updatePending] = useActionState<
    UpdateClientState,
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
      `¿Eliminar el cliente "${initial.name}" definitivamente? ` +
        "Esta acción no se puede deshacer. Si tiene projects/tickets/renewals/upsells/nps o health cargada, la operación va a rebotar — en ese caso usá Archivar.",
    );
    if (!ok) return;
    setDeleteError(null);
    startDeleteTransition(async () => {
      const result = await deleteClient(initial.id);
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
          placeholder="Ej. Empresa Charcutería SRL o Marcos Consulting"
          style={inputStyle}
          autoFocus
        />
      </Field>

      <Field label="Razón social" htmlFor="business_name">
        <input
          id="business_name"
          name="business_name"
          type="text"
          defaultValue={initial?.businessName ?? ""}
          placeholder="Opcional — cómo se factura al cliente"
          style={inputStyle}
        />
      </Field>

      <Field label="Industria" htmlFor="industry">
        <input
          id="industry"
          name="industry"
          type="text"
          defaultValue={initial?.industry ?? ""}
          placeholder="Ej. ecommerce, gastronomía, coach"
          style={inputStyle}
        />
      </Field>

      <Field label="Notas" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={initial?.notes ?? ""}
          placeholder="Contexto libre — contacto principal, historial, etc."
          style={{ ...inputStyle, resize: "vertical", minHeight: 72 }}
        />
      </Field>

      {isEdit && (
        <label
          htmlFor="active_toggle"
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
            id="active_toggle"
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
              Cliente activo
            </div>
            <div
              className="kg-t7"
              style={{ color: "var(--kg-text-3)", marginTop: 2 }}
            >
              Los archivados no aparecen en el listado por defecto ni se
              pueden usar como destino en nuevos tickets/renewals/upsells.
            </div>
          </div>
        </label>
      )}

      {/* Hidden input: SIEMPRE envía el estado deseado. Un checkbox HTML
          crudo omite el valor cuando está unchecked; este hidden garantiza
          que "on" o "off" viaja explícito al server action. */}
      {isEdit && (
        <input type="hidden" name="active" value={active ? "on" : "off"} />
      )}

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
            title="Elimina el cliente (solo si no tiene datos colgados)"
          >
            {deletePending ? "Eliminando…" : "Eliminar cliente"}
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
                : "Crear cliente"}
          </button>
        </div>
      </div>
    </form>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Sub-componentes / estilos — mismos que payroll-form-drawer para consistencia
// ═══════════════════════════════════════════════════════════════════════════

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
