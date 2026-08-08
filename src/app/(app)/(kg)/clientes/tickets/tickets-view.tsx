"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { StatusPill } from "@/components/kg/status-pill";
import type { TicketPriority, TicketStatus } from "@/lib/clients/types";

import { deleteTicket } from "./actions";
import {
  TicketFormDrawer,
  type ClientOptionForTicket,
  type PersonOptionForTicket,
  type TicketInitial,
} from "./ticket-form-drawer";

// ═══════════════════════════════════════════════════════════════════════════
// Vista de tickets con drawer para crear/editar y row actions.
//
// Recibe todo pre-fetch de la page (server). Este componente maneja el
// estado del drawer y las llamadas a deleteTicket. Los filtros de status/
// priority/client viven en la URL — la page filtra antes de mandar rows.
// ═══════════════════════════════════════════════════════════════════════════

export interface TicketRowData {
  readonly id: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly assigneePersonId: string | null;
  readonly assigneeName: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly status: TicketStatus;
  readonly priority: TicketPriority;
  readonly category: string | null;
  readonly dueDate: string | null;
  readonly resolvedAt: string | null;
  readonly createdAt: string;
}

const STATUS_LABEL: Record<TicketStatus, string> = {
  abierto: "Abierto",
  en_progreso: "En progreso",
  esperando_cliente: "Esperando cliente",
  resuelto: "Resuelto",
  cerrado: "Cerrado",
};

const STATUS_TONE: Record<TicketStatus, string> = {
  abierto: "var(--kg-accent-500)",
  en_progreso: "var(--kg-warning-500)",
  esperando_cliente: "var(--kg-neutral-500)",
  resuelto: "var(--kg-positive-500)",
  cerrado: "var(--kg-neutral-500)",
};

const PRIORITY_LABEL: Record<TicketPriority, string> = {
  baja: "Baja",
  media: "Media",
  alta: "Alta",
  urgente: "Urgente",
};

const PRIORITY_TONE: Record<TicketPriority, string> = {
  baja: "var(--kg-neutral-500)",
  media: "var(--kg-neutral-500)",
  alta: "var(--kg-warning-500)",
  urgente: "var(--kg-negative-500)",
};

export function TicketsView({
  rows,
  totalCount,
  clients,
  people,
  presetClientId,
}: {
  readonly rows: readonly TicketRowData[];
  readonly totalCount: number;
  readonly clients: readonly ClientOptionForTicket[];
  readonly people: readonly PersonOptionForTicket[];
  readonly presetClientId: string | null;
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const editing =
    editingId != null ? rows.find((r) => r.id === editingId) ?? null : null;
  const editingInitial: TicketInitial | undefined =
    editing != null
      ? {
          id: editing.id,
          clientId: editing.clientId,
          projectId: editing.projectId,
          assigneePersonId: editing.assigneePersonId,
          title: editing.title,
          description: editing.description,
          status: editing.status,
          priority: editing.priority,
          category: editing.category,
          dueDate: editing.dueDate,
          resolvedAt: editing.resolvedAt,
        }
      : undefined;

  function handleDelete(row: TicketRowData) {
    const ok = window.confirm(
      `¿Eliminar el ticket "${row.title}"? Esta acción no se puede deshacer.`,
    );
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteTicket(row.id);
      if ("error" in result) setError(result.error);
    });
  }

  const columns: Column<TicketRowData>[] = [
    {
      key: "title",
      label: "Ticket",
      render: (r) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <button
            type="button"
            onClick={() => setEditingId(r.id)}
            className="kg-focus"
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              color: "var(--kg-text-1)",
              fontWeight: 600,
              fontSize: 13,
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            {r.title}
          </button>
          {r.projectName && (
            <div
              className="kg-t7"
              style={{ color: "var(--kg-text-3)" }}
            >
              Launch: {r.projectName}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "client",
      label: "Cliente",
      render: (r) => (
        <Link
          href={`/clientes/${r.clientId}`}
          className="kg-focus"
          style={{
            color: "var(--kg-text-2)",
            textDecoration: "none",
            fontSize: 12,
          }}
        >
          {r.clientName}
        </Link>
      ),
    },
    {
      key: "status",
      label: "Estado",
      render: (r) => (
        <StatusPill text={STATUS_LABEL[r.status]} tone={STATUS_TONE[r.status]} />
      ),
    },
    {
      key: "priority",
      label: "Prioridad",
      render: (r) => (
        <StatusPill
          text={PRIORITY_LABEL[r.priority]}
          tone={PRIORITY_TONE[r.priority]}
        />
      ),
    },
    {
      key: "assignee",
      label: "Asignado",
      render: (r) =>
        r.assigneeName ?? (
          <span style={{ color: "var(--kg-text-3)" }}>Sin asignar</span>
        ),
    },
    {
      key: "due",
      label: "Vence",
      render: (r) =>
        r.dueDate == null ? (
          <span style={{ color: "var(--kg-text-3)" }}>—</span>
        ) : (
          formatDate(r.dueDate)
        ),
    },
    {
      key: "actions",
      label: "",
      align: "right",
      render: (r) => (
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={() => setEditingId(r.id)}
            disabled={pending}
            className="kg-focus"
            style={rowBtn}
          >
            Editar
          </button>
          <button
            type="button"
            onClick={() => handleDelete(r)}
            disabled={pending}
            className="kg-focus"
            style={{ ...rowBtn, color: "#EF4444", borderColor: "#EF4444" }}
          >
            Eliminar
          </button>
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="kg-focus"
          style={primaryBtn}
        >
          + Nuevo ticket
        </button>
      </div>

      {error && (
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
          {error}
        </div>
      )}

      <KgDataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        totalCount={totalCount}
        emptyTitle="Sin tickets que coincidan con el filtro"
        emptyHint="Cambiá el filtro o creá un ticket nuevo."
      />

      <TicketFormDrawer
        mode="create"
        open={creating}
        onClose={() => setCreating(false)}
        clients={clients}
        people={people}
        presetClientId={presetClientId}
      />

      <TicketFormDrawer
        mode="edit"
        open={editingId != null}
        onClose={() => setEditingId(null)}
        clients={clients}
        people={people}
        initial={editingInitial}
      />
    </div>
  );
}

function formatDate(ymd: string): string {
  // Aceptamos "YYYY-MM-DD" (due_date es date) o ISO completo.
  try {
    const d = ymd.length === 10 ? new Date(`${ymd}T12:00:00Z`) : new Date(ymd);
    return d.toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return ymd.slice(0, 10);
  }
}

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
