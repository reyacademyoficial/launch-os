"use client";

import { useActionState, useEffect, useMemo, useState } from "react";

import { Drawer } from "@/components/kg/drawer";
import type { TicketPriority, TicketStatus } from "@/lib/clients/types";

import {
  createTicket,
  updateTicket,
  type CreateTicketState,
  type UpdateTicketState,
} from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer para crear o editar un ticket.
//
// Cliente REQUERIDO. Project OPCIONAL: si el cliente tiene projects atados,
// aparecen en el dropdown filtrado por cliente seleccionado. Si no tiene,
// el dropdown queda deshabilitado con hint.
//
// El estado resuelto/cerrado marca resolved_at automáticamente en el server
// action; el drawer no muestra el campo.
// ═══════════════════════════════════════════════════════════════════════════

export interface ClientOptionForTicket {
  readonly id: string;
  readonly name: string;
  readonly projects: readonly { id: string; name: string }[];
}

export interface PersonOptionForTicket {
  readonly id: string;
  readonly fullName: string;
}

export interface TicketInitial {
  readonly id: string;
  readonly clientId: string;
  readonly projectId: string | null;
  readonly assigneePersonId: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly status: TicketStatus;
  readonly priority: TicketPriority;
  readonly category: string | null;
  readonly dueDate: string | null;
  readonly resolvedAt: string | null;
}

const STATUS_OPTIONS: ReadonlyArray<{ value: TicketStatus; label: string }> = [
  { value: "abierto", label: "Abierto" },
  { value: "en_progreso", label: "En progreso" },
  { value: "esperando_cliente", label: "Esperando cliente" },
  { value: "resuelto", label: "Resuelto" },
  { value: "cerrado", label: "Cerrado" },
];

const PRIORITY_OPTIONS: ReadonlyArray<{
  value: TicketPriority;
  label: string;
}> = [
  { value: "baja", label: "Baja" },
  { value: "media", label: "Media" },
  { value: "alta", label: "Alta" },
  { value: "urgente", label: "Urgente" },
];

export function TicketFormDrawer({
  mode,
  open,
  onClose,
  clients,
  people,
  initial,
  presetClientId,
}: {
  readonly mode: "create" | "edit";
  readonly open: boolean;
  readonly onClose: () => void;
  readonly clients: readonly ClientOptionForTicket[];
  readonly people: readonly PersonOptionForTicket[];
  readonly initial?: TicketInitial;
  /** Cliente pre-seleccionado en create (viene del filtro activo). */
  readonly presetClientId?: string | null;
}) {
  if (!open) return null;
  const title = mode === "create" ? "Nuevo ticket" : "Editar ticket";
  return (
    <Drawer open={open} onClose={onClose} title={title} width={600}>
      <TicketFormBody
        mode={mode}
        clients={clients}
        people={people}
        initial={initial}
        presetClientId={presetClientId}
        onClose={onClose}
      />
    </Drawer>
  );
}

function TicketFormBody({
  mode,
  clients,
  people,
  initial,
  presetClientId,
  onClose,
}: {
  readonly mode: "create" | "edit";
  readonly clients: readonly ClientOptionForTicket[];
  readonly people: readonly PersonOptionForTicket[];
  readonly initial?: TicketInitial;
  readonly presetClientId?: string | null;
  readonly onClose: () => void;
}) {
  const isEdit = mode === "edit" && initial != null;

  const updateBound = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id;
    return async (prev: UpdateTicketState, fd: FormData) =>
      updateTicket(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createFormAction, createPending] = useActionState<
    CreateTicketState,
    FormData
  >(createTicket, null);
  const [updateState, updateFormAction, updatePending] = useActionState<
    UpdateTicketState,
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

  const initialClientId =
    initial?.clientId ?? presetClientId ?? clients[0]?.id ?? "";
  const [clientId, setClientId] = useState<string>(initialClientId);
  const [projectId, setProjectId] = useState<string>(initial?.projectId ?? "");
  const [status, setStatus] = useState<TicketStatus>(
    initial?.status ?? "abierto",
  );

  const selectedClient = clients.find((c) => c.id === clientId) ?? null;
  const projectsForClient = selectedClient?.projects ?? [];

  // Si cambia el cliente en modo create y el project seleccionado no
  // pertenece al nuevo cliente, lo limpiamos. En edit respetamos initial
  // hasta que el usuario cambie manualmente.
  function handleClientChange(nextId: string) {
    setClientId(nextId);
    const nextClient = clients.find((c) => c.id === nextId);
    if (!nextClient) {
      setProjectId("");
      return;
    }
    if (!nextClient.projects.some((p) => p.id === projectId)) {
      setProjectId("");
    }
  }

  if (clients.length === 0) {
    return (
      <div style={{ padding: 8 }}>
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", lineHeight: 1.55 }}
        >
          No hay clientes activos cargados. Andá a{" "}
          <a
            href="/clientes"
            style={{ color: "var(--kg-accent-500)" }}
          >
            Clientes
          </a>{" "}
          para dar de alta al menos uno antes de crear tickets.
        </div>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <Field label="Cliente" htmlFor="client_id" required>
        <select
          id="client_id"
          name="client_id"
          value={clientId}
          onChange={(e) => handleClientChange(e.target.value)}
          required
          style={inputStyle}
        >
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Project (opcional)" htmlFor="project_id">
        <select
          id="project_id"
          name="project_id"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          disabled={projectsForClient.length === 0}
          style={inputStyle}
        >
          <option value="">— Sin atar a un launch —</option>
          {projectsForClient.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginTop: 6 }}
        >
          {projectsForClient.length === 0
            ? "Este cliente no tiene projects atados. Atalo desde la ficha del cliente si querés referenciar un launch."
            : "Opcional. Solo se listan projects atados al cliente seleccionado."}
        </div>
      </Field>

      <Field label="Título" htmlFor="title" required>
        <input
          id="title"
          name="title"
          type="text"
          required
          maxLength={300}
          defaultValue={initial?.title ?? ""}
          placeholder="Ej. Cliente pidió cambio de fecha del launch"
          style={inputStyle}
        />
      </Field>

      <Field label="Descripción" htmlFor="description">
        <textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={initial?.description ?? ""}
          placeholder="Contexto libre — qué pidió, qué esperamos hacer"
          style={{ ...inputStyle, resize: "vertical", minHeight: 72 }}
        />
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Estado" htmlFor="status" required>
          <select
            id="status"
            name="status"
            value={status}
            onChange={(e) => setStatus(e.target.value as TicketStatus)}
            style={inputStyle}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Prioridad" htmlFor="priority" required>
          <select
            id="priority"
            name="priority"
            defaultValue={initial?.priority ?? "media"}
            style={inputStyle}
          >
            {PRIORITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Categoría" htmlFor="category">
          <input
            id="category"
            name="category"
            type="text"
            defaultValue={initial?.category ?? ""}
            placeholder="Ej. campaña, billing"
            style={inputStyle}
          />
        </Field>
        <Field label="Vencimiento" htmlFor="due_date">
          <input
            id="due_date"
            name="due_date"
            type="date"
            defaultValue={initial?.dueDate ?? ""}
            style={inputStyle}
          />
        </Field>
      </div>

      <Field label="Asignado" htmlFor="assignee_person_id">
        <select
          id="assignee_person_id"
          name="assignee_person_id"
          defaultValue={initial?.assigneePersonId ?? ""}
          style={inputStyle}
        >
          <option value="">— Sin asignar —</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.fullName}
            </option>
          ))}
        </select>
      </Field>

      {isEdit && initial?.resolvedAt && (
        <div
          className="kg-t7"
          style={{
            color: "var(--kg-text-3)",
            padding: "8px 12px",
            borderRadius: "var(--kg-r-8)",
            background: "var(--kg-surface-2-solid)",
            border: "1px solid var(--kg-border-subtle)",
          }}
        >
          Cerrado el {formatDate(initial.resolvedAt)}. Si volvés a un estado
          abierto, se resetea; si guardás con estado cerrado, se preserva.
        </div>
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
            ? isEdit
              ? "Guardando…"
              : "Creando…"
            : isEdit
              ? "Guardar cambios"
              : "Crear ticket"}
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

function formatDate(iso: string): string {
  try {
    return new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
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
