"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { StatusPill } from "@/components/kg/status-pill";
import { fMoney } from "@/lib/finance/format";
import type { RenewalStatus } from "@/lib/clients/types";

import { deleteRenewal } from "./actions";
import {
  RenewalFormDrawer,
  type ClientOptionForRenewal,
  type RenewalInitial,
} from "./renewal-form-drawer";

// ═══════════════════════════════════════════════════════════════════════════
// Vista de renewals con drawer + row actions. Recibe rows y opciones ya
// filtradas por la page (server).
// ═══════════════════════════════════════════════════════════════════════════

export interface RenewalRowData {
  readonly id: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly amount: number;
  readonly currency: "ARS" | "USD";
  readonly status: RenewalStatus;
  readonly collectedAt: string | null;
  readonly lossReason: string | null;
  readonly notes: string | null;
}

const STATUS_LABEL: Record<RenewalStatus, string> = {
  propuesta: "Propuesta",
  confirmada: "Confirmada",
  facturada: "Facturada",
  cobrada: "Cobrada",
  perdida: "Perdida",
};

const STATUS_TONE: Record<RenewalStatus, string> = {
  propuesta: "var(--kg-neutral-500)",
  confirmada: "var(--kg-accent-500)",
  facturada: "var(--kg-warning-500)",
  cobrada: "var(--kg-positive-500)",
  perdida: "var(--kg-negative-500)",
};

export function RenewalsView({
  rows,
  totalCount,
  clients,
  presetClientId,
}: {
  readonly rows: readonly RenewalRowData[];
  readonly totalCount: number;
  readonly clients: readonly ClientOptionForRenewal[];
  readonly presetClientId: string | null;
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const editing =
    editingId != null ? rows.find((r) => r.id === editingId) ?? null : null;
  const editingInitial: RenewalInitial | undefined = editing
    ? {
        id: editing.id,
        clientId: editing.clientId,
        periodStart: editing.periodStart,
        periodEnd: editing.periodEnd,
        amount: editing.amount,
        currency: editing.currency,
        status: editing.status,
        collectedAt: editing.collectedAt,
        lossReason: editing.lossReason,
        notes: editing.notes,
      }
    : undefined;

  function handleDelete(row: RenewalRowData) {
    const period = `${formatMonth(row.periodStart)} – ${formatMonth(row.periodEnd)}`;
    const ok = window.confirm(
      `¿Eliminar la renewal de "${row.clientName}" (${period}, ${fMoneyCur(row.amount, row.currency)})? Esta acción no se puede deshacer y altera el LTV histórico si estaba cobrada.`,
    );
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteRenewal(row.id);
      if ("error" in result) setError(result.error);
    });
  }

  const columns: Column<RenewalRowData>[] = [
    {
      key: "client",
      label: "Cliente",
      render: (r) => (
        <Link
          href={`/clientes/${r.clientId}`}
          className="kg-focus"
          style={{
            color: "var(--kg-text-1)",
            textDecoration: "none",
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          {r.clientName}
        </Link>
      ),
    },
    {
      key: "period",
      label: "Período",
      render: (r) => `${formatMonth(r.periodStart)} – ${formatMonth(r.periodEnd)}`,
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
        if (r.status === "cobrada" && r.collectedAt) {
          return `Cobrada el ${formatDate(r.collectedAt)}`;
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
          + Nueva renewal
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
        emptyTitle="Sin renewals que coincidan con el filtro"
        emptyHint="Cambiá el filtro o registrá una renewal nueva."
      />

      <RenewalFormDrawer
        mode="create"
        open={creating}
        onClose={() => setCreating(false)}
        clients={clients}
        presetClientId={presetClientId}
      />

      <RenewalFormDrawer
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
// Helpers de formato locales — currency-aware. Duplicado deliberado con
// upsells/view: cada archivo se mantiene grep-eable de forma independiente.
// ═══════════════════════════════════════════════════════════════════════════

export function fMoneyCur(amount: number, currency: "ARS" | "USD"): string {
  const raw = fMoney(amount); // devuelve "$1.234"
  // Reemplazamos "$" por "AR$" o "US$" para desambiguar.
  const prefix = currency === "USD" ? "US$" : "AR$";
  return raw.replace(/^(-?)\$/, `$1${prefix} `);
}

function formatMonth(ymd: string): string {
  try {
    const d = new Date(`${ymd}T12:00:00Z`);
    return d.toLocaleDateString("es-AR", { month: "short", year: "numeric" });
  } catch {
    return ymd.slice(0, 10);
  }
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
