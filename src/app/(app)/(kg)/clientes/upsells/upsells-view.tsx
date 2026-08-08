"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { StatusPill } from "@/components/kg/status-pill";
import { fMoney } from "@/lib/finance/format";
import type { UpsellStatus } from "@/lib/clients/types";

import { deleteUpsell } from "./actions";
import {
  UpsellFormDrawer,
  type ClientOptionForUpsell,
  type UpsellInitial,
} from "./upsell-form-drawer";

// ═══════════════════════════════════════════════════════════════════════════
// Vista de upsells con drawer + row actions. Simétrica a renewals-view.
// Diferencias: título/categoría/closed_at (en vez de período/collected_at).
// ═══════════════════════════════════════════════════════════════════════════

export interface UpsellRowData {
  readonly id: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly title: string;
  readonly description: string | null;
  readonly category: string | null;
  readonly amount: number;
  readonly currency: "ARS" | "USD";
  readonly status: UpsellStatus;
  readonly closedAt: string | null;
  readonly lossReason: string | null;
  readonly notes: string | null;
}

const STATUS_LABEL: Record<UpsellStatus, string> = {
  propuesta: "Propuesta",
  confirmada: "Confirmada",
  facturada: "Facturada",
  cobrada: "Cobrada",
  perdida: "Perdida",
};

const STATUS_TONE: Record<UpsellStatus, string> = {
  propuesta: "var(--kg-neutral-500)",
  confirmada: "var(--kg-accent-500)",
  facturada: "var(--kg-warning-500)",
  cobrada: "var(--kg-positive-500)",
  perdida: "var(--kg-negative-500)",
};

export function UpsellsView({
  rows,
  totalCount,
  clients,
  presetClientId,
}: {
  readonly rows: readonly UpsellRowData[];
  readonly totalCount: number;
  readonly clients: readonly ClientOptionForUpsell[];
  readonly presetClientId: string | null;
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const editing =
    editingId != null ? rows.find((r) => r.id === editingId) ?? null : null;
  const editingInitial: UpsellInitial | undefined = editing
    ? {
        id: editing.id,
        clientId: editing.clientId,
        title: editing.title,
        description: editing.description,
        category: editing.category,
        amount: editing.amount,
        currency: editing.currency,
        status: editing.status,
        closedAt: editing.closedAt,
        lossReason: editing.lossReason,
        notes: editing.notes,
      }
    : undefined;

  function handleDelete(row: UpsellRowData) {
    const ok = window.confirm(
      `¿Eliminar el upsell "${row.title}" (${row.clientName}, ${fMoneyCur(row.amount, row.currency)})? Esta acción no se puede deshacer y altera el LTV histórico si estaba cobrado.`,
    );
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteUpsell(row.id);
      if ("error" in result) setError(result.error);
    });
  }

  const columns: Column<UpsellRowData>[] = [
    {
      key: "title",
      label: "Upsell",
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
          {r.category && (
            <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
              {r.category}
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
      key: "amount",
      label: "Monto",
      align: "right",
      numeric: true,
      render: (r) => fMoneyCur(r.amount, r.currency),
    },
    {
      key: "status",
      label: "Estado",
      render: (r) => (
        <StatusPill text={STATUS_LABEL[r.status]} tone={STATUS_TONE[r.status]} />
      ),
    },
    {
      key: "closure",
      label: "Cierre",
      render: (r) => {
        if (r.status === "cobrada" && r.closedAt) {
          return `Cobrado el ${formatDate(r.closedAt)}`;
        }
        if (r.status === "perdida") {
          return r.lossReason ? (
            <span style={{ color: "var(--kg-text-2)" }}>{r.lossReason}</span>
          ) : (
            <span style={{ color: "var(--kg-text-3)" }}>Sin motivo</span>
          );
        }
        return <span style={{ color: "var(--kg-text-3)" }}>—</span>;
      },
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
          + Nuevo upsell
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
        emptyTitle="Sin upsells que coincidan con el filtro"
        emptyHint="Cambiá el filtro o registrá un upsell nuevo."
      />

      <UpsellFormDrawer
        mode="create"
        open={creating}
        onClose={() => setCreating(false)}
        clients={clients}
        presetClientId={presetClientId}
      />

      <UpsellFormDrawer
        mode="edit"
        open={editingId != null}
        onClose={() => setEditingId(null)}
        clients={clients}
        initial={editingInitial}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers de formato locales. Duplicado deliberado con renewals-view: cada
// archivo se mantiene grep-eable independiente.
// ═══════════════════════════════════════════════════════════════════════════

export function fMoneyCur(amount: number, currency: "ARS" | "USD"): string {
  const raw = fMoney(amount);
  const prefix = currency === "USD" ? "US$" : "AR$";
  return raw.replace(/^(-?)\$/, `$1${prefix} `);
}

function formatDate(ymd: string): string {
  try {
    const d = new Date(`${ymd}T12:00:00Z`);
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
