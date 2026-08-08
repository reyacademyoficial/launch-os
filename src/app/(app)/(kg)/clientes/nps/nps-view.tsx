"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { StatusPill } from "@/components/kg/status-pill";
import { classifyNps } from "@/lib/clients/health";
import type { NpsBucket } from "@/lib/clients/types";

import { deleteNps } from "./actions";
import {
  NpsFormDrawer,
  type ClientOptionForNps,
  type NpsInitial,
} from "./nps-form-drawer";

// ═══════════════════════════════════════════════════════════════════════════
// Vista de respuestas NPS. Recibe rows ya filtradas por la page.
// ═══════════════════════════════════════════════════════════════════════════

export interface NpsRowData {
  readonly id: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly respondentName: string | null;
  readonly respondentEmail: string | null;
  readonly score: number;
  readonly comment: string | null;
  readonly channel: string | null;
  readonly respondedAt: string;
}

const BUCKET_LABEL: Record<NpsBucket, string> = {
  promoter: "Promotor",
  passive: "Pasivo",
  detractor: "Detractor",
};

const BUCKET_TONE: Record<NpsBucket, string> = {
  promoter: "var(--kg-positive-500)",
  passive: "var(--kg-warning-500)",
  detractor: "var(--kg-negative-500)",
};

export function NpsView({
  rows,
  totalCount,
  clients,
  presetClientId,
}: {
  readonly rows: readonly NpsRowData[];
  readonly totalCount: number;
  readonly clients: readonly ClientOptionForNps[];
  readonly presetClientId: string | null;
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const editing =
    editingId != null ? rows.find((r) => r.id === editingId) ?? null : null;
  const editingInitial: NpsInitial | undefined = editing
    ? {
        id: editing.id,
        clientId: editing.clientId,
        respondentName: editing.respondentName,
        respondentEmail: editing.respondentEmail,
        score: editing.score,
        comment: editing.comment,
        channel: editing.channel,
        respondedAt: editing.respondedAt,
      }
    : undefined;

  function handleDelete(row: NpsRowData) {
    const respondent =
      row.respondentName ?? row.respondentEmail ?? "sin identificar";
    const ok = window.confirm(
      `¿Eliminar la respuesta NPS de ${respondent} (${row.clientName}, score ${row.score})? No se puede deshacer.`,
    );
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteNps(row.id);
      if ("error" in result) setError(result.error);
    });
  }

  const columns: Column<NpsRowData>[] = [
    {
      key: "date",
      label: "Fecha",
      render: (r) => formatDate(r.respondedAt),
    },
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
      key: "score",
      label: "Score",
      align: "right",
      numeric: true,
      render: (r) => String(r.score),
    },
    {
      key: "bucket",
      label: "Clasificación",
      render: (r) => {
        const bucket = classifyNps(r.score);
        return (
          <StatusPill text={BUCKET_LABEL[bucket]} tone={BUCKET_TONE[bucket]} />
        );
      },
    },
    {
      key: "respondent",
      label: "Respondente",
      render: (r) => {
        if (r.respondentName && r.respondentEmail) {
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ color: "var(--kg-text-1)", fontSize: 12 }}>
                {r.respondentName}
              </span>
              <span
                className="kg-t7"
                style={{ color: "var(--kg-text-3)" }}
              >
                {r.respondentEmail}
              </span>
            </div>
          );
        }
        return (
          r.respondentName ??
          r.respondentEmail ?? (
            <span style={{ color: "var(--kg-text-3)" }}>Anónimo</span>
          )
        );
      },
    },
    {
      key: "channel",
      label: "Canal",
      render: (r) =>
        r.channel ?? <span style={{ color: "var(--kg-text-3)" }}>—</span>,
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
          + Nueva respuesta
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
        emptyTitle="Sin respuestas NPS que coincidan con el filtro"
        emptyHint="Cambiá el filtro o cargá una respuesta nueva."
      />

      <NpsFormDrawer
        mode="create"
        open={creating}
        onClose={() => setCreating(false)}
        clients={clients}
        presetClientId={presetClientId}
      />

      <NpsFormDrawer
        mode="edit"
        open={editingId != null}
        onClose={() => setEditingId(null)}
        clients={clients}
        initial={editingInitial}
      />
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
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
