"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { StatusPill } from "@/components/kg/status-pill";
import type { RelationshipStatus } from "@/lib/clients/types";

import { deactivateClient, reactivateClient } from "./actions";
import {
  ClientFormDrawer,
  type ClientInitial,
} from "./client-form-drawer";

// ═══════════════════════════════════════════════════════════════════════════
// Shape serializable — mismo criterio que NominaView / PersonasTable, todos
// los derivados los hace la page (server); este cliente compone + drawer.
// ═══════════════════════════════════════════════════════════════════════════

export interface ClientRowData {
  readonly id: string;
  readonly name: string;
  readonly businessName: string | null;
  readonly industry: string | null;
  readonly notes: string | null;
  readonly active: boolean;
  readonly projectsCount: number;
  readonly relationshipStatus: RelationshipStatus | null;
  /** Score efectivo. Manual gana; sino, compuesto. */
  readonly healthScore: number | null;
  /** `manual` = override; `compuesto` = derivado de NPS + contacto + tickets. */
  readonly healthScoreKind: "manual" | "compuesto";
  /** Solo relevante para compuesto — true si faltaron ingredientes. */
  readonly healthScoreLimited: boolean;
}

const RELATIONSHIP_LABEL: Record<RelationshipStatus, string> = {
  onboarding: "Onboarding",
  activa: "Activa",
  en_riesgo: "En riesgo",
  perdida: "Perdida",
};

const RELATIONSHIP_TONE: Record<RelationshipStatus, string> = {
  onboarding: "var(--kg-accent-500)",
  activa: "var(--kg-positive-500)",
  en_riesgo: "var(--kg-warning-500)",
  perdida: "var(--kg-negative-500)",
};

export function ClientesView({
  rows,
  totalCount,
}: {
  readonly rows: readonly ClientRowData[];
  readonly totalCount: number;
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const editing =
    editingId != null ? rows.find((r) => r.id === editingId) ?? null : null;
  const editingInitial: ClientInitial | undefined =
    editing != null
      ? {
          id: editing.id,
          name: editing.name,
          businessName: editing.businessName,
          industry: editing.industry,
          notes: editing.notes,
          active: editing.active,
        }
      : undefined;

  function handleToggleActive(row: ClientRowData) {
    setError(null);
    startTransition(async () => {
      const result = row.active
        ? await deactivateClient(row.id)
        : await reactivateClient(row.id);
      if ("error" in result) setError(result.error);
    });
  }

  const columns: Column<ClientRowData>[] = [
    {
      key: "name",
      label: "Nombre",
      render: (r) => (
        <Link
          href={`/clientes/${r.id}`}
          className="kg-focus"
          style={{
            color: "var(--kg-text-1)",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          {r.name}
        </Link>
      ),
    },
    {
      key: "business_name",
      label: "Razón social",
      render: (r) => r.businessName ?? "—",
    },
    {
      key: "industry",
      label: "Industria",
      render: (r) => r.industry ?? "—",
    },
    {
      key: "projects",
      label: "Projects",
      align: "right",
      numeric: true,
      render: (r) => (r.projectsCount === 0 ? "—" : String(r.projectsCount)),
    },
    {
      key: "relationship",
      label: "Relación",
      render: (r) =>
        r.relationshipStatus == null ? (
          <span style={{ color: "var(--kg-text-3)" }}>—</span>
        ) : (
          <StatusPill
            text={RELATIONSHIP_LABEL[r.relationshipStatus]}
            tone={RELATIONSHIP_TONE[r.relationshipStatus]}
          />
        ),
    },
    {
      key: "health_score",
      label: "Health",
      align: "right",
      numeric: true,
      render: (r) => {
        if (r.healthScore == null) {
          return <span style={{ color: "var(--kg-text-3)" }}>—</span>;
        }
        const scoreTone =
          r.healthScore >= 70
            ? "var(--kg-positive-500)"
            : r.healthScore >= 40
              ? "var(--kg-warning-500)"
              : "var(--kg-negative-500)";
        return (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              justifyContent: "flex-end",
            }}
            title={
              r.healthScoreKind === "manual"
                ? "Override manual"
                : r.healthScoreLimited
                  ? "Compuesto · datos limitados"
                  : "Compuesto"
            }
          >
            <span
              className="kg-num"
              style={{
                fontVariantNumeric: "tabular-nums",
                color: "var(--kg-text-1)",
              }}
            >
              {r.healthScore}
              {r.healthScoreKind === "compuesto" && r.healthScoreLimited && "*"}
            </span>
            <span
              aria-hidden
              style={{
                width: 5,
                height: 5,
                borderRadius: 999,
                background: scoreTone,
              }}
            />
          </div>
        );
      },
    },
    {
      key: "status",
      label: "Registro",
      render: (r) => (
        <StatusPill
          text={r.active ? "Activo" : "Archivado"}
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
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={() => setEditingId(r.id)}
            disabled={pending}
            className="kg-focus"
            style={rowBtn}
            title="Editar"
          >
            Editar
          </button>
          <button
            type="button"
            onClick={() => handleToggleActive(r)}
            disabled={pending}
            className="kg-focus"
            style={rowBtn}
            title={r.active ? "Archivar" : "Reactivar"}
          >
            {r.active ? "Archivar" : "Reactivar"}
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
          + Nuevo cliente
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
        emptyTitle="Sin clientes que coincidan con el filtro"
        emptyHint="Cambiá el filtro o creá un cliente nuevo."
      />

      <ClientFormDrawer
        mode="create"
        open={creating}
        onClose={() => setCreating(false)}
      />

      <ClientFormDrawer
        mode="edit"
        open={editingId != null}
        onClose={() => setEditingId(null)}
        initial={editingInitial}
      />
    </div>
  );
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
