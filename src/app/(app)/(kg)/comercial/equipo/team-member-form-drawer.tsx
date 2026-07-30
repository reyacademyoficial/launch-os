"use client";

import { useActionState, useEffect, useMemo } from "react";

import { Drawer } from "@/components/kg/drawer";
import type { TeamMemberRole } from "@/lib/team/types";

import {
  createTeamMember,
  updateTeamMember,
  type CreateTeamMemberState,
  type UpdateTeamMemberState,
} from "./actions";

export interface ProjectOption {
  readonly id: string;
  readonly name: string;
}

export interface TeamMemberInitial {
  readonly id?: string;
  readonly projectId?: string;
  readonly name?: string;
  readonly role?: TeamMemberRole;
  readonly commissionRate?: number | null;
}

export interface TeamMemberFormDrawerProps {
  readonly mode: "create" | "edit";
  readonly initial?: TeamMemberInitial;
  readonly projects: readonly ProjectOption[];
  readonly open: boolean;
  readonly onClose: () => void;
}

const ROLE_OPTIONS: ReadonlyArray<{ value: TeamMemberRole; label: string }> = [
  { value: "setter", label: "Setter" },
  { value: "closer", label: "Closer" },
  { value: "media_buyer", label: "Media buyer" },
  { value: "manager", label: "Manager" },
  { value: "otro", label: "Otro" },
];

export function TeamMemberFormDrawer(props: TeamMemberFormDrawerProps) {
  if (!props.open) return null;
  const title = props.mode === "create" ? "Nuevo miembro" : "Editar miembro";
  return (
    <Drawer open={props.open} onClose={props.onClose} title={title} width={480}>
      <FormBody {...props} />
    </Drawer>
  );
}

function FormBody({
  mode,
  initial,
  projects,
  onClose,
}: TeamMemberFormDrawerProps) {
  const isEdit = mode === "edit" && initial?.id;
  const updateBound = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id!;
    return async (prev: UpdateTeamMemberState, fd: FormData) =>
      updateTeamMember(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createFormAction, createPending] =
    useActionState<CreateTeamMemberState, FormData>(createTeamMember, null);
  const [updateState, updateFormAction, updatePending] =
    useActionState<UpdateTeamMemberState, FormData>(
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

  const submitLabel = mode === "create" ? "Crear miembro" : "Guardar cambios";

  return (
    <form
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <Field label="Proyecto" htmlFor="project_id" required>
        <select
          id="project_id"
          name="project_id"
          required
          defaultValue={initial?.projectId ?? ""}
          disabled={isEdit ? true : false}
          style={{
            ...inputStyle,
            opacity: isEdit ? 0.7 : 1,
            cursor: isEdit ? "not-allowed" : "auto",
          }}
        >
          {!isEdit && <option value="">Elegí un proyecto…</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {isEdit && (
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-3)", marginTop: 6 }}
          >
            No se puede cambiar el proyecto de un miembro existente. Si hace
            falta, desactivalo y creá uno nuevo en el proyecto correcto.
          </div>
        )}
      </Field>

      <Field label="Nombre" htmlFor="name" required>
        <input
          id="name"
          name="name"
          type="text"
          required
          defaultValue={initial?.name ?? ""}
          placeholder="Nombre y apellido"
          autoComplete="off"
          style={inputStyle}
        />
      </Field>

      <Field label="Rol" htmlFor="role" required>
        <select
          id="role"
          name="role"
          required
          defaultValue={initial?.role ?? "closer"}
          style={inputStyle}
        >
          {ROLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="% de comisión (opcional)" htmlFor="commission_rate">
        <input
          id="commission_rate"
          name="commission_rate"
          type="number"
          step="0.01"
          min="0"
          defaultValue={initial?.commissionRate ?? ""}
          placeholder="Ej. 10 (opcional; alternativa a la regla del proyecto)"
          style={inputStyle}
        />
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginTop: 6 }}
        >
          Si el miembro cobra un % fijo distinto al del proyecto, cargalo
          acá. Si dejás vacío, se aplica la regla de comisiones estándar.
        </div>
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

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          marginTop: 4,
        }}
      >
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="kg-focus"
          style={secondaryBtn}
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={pending}
          className="kg-focus"
          style={{ ...primaryBtn, opacity: pending ? 0.7 : 1 }}
        >
          {pending
            ? mode === "create"
              ? "Creando…"
              : "Guardando…"
            : submitLabel}
        </button>
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
