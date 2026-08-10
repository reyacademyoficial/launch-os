"use client";

import { useState } from "react";

import { EmptyState } from "@/components/kg/empty-state";
import { KgDataTable, type Column } from "@/components/kg/data-table";
import { fMoney } from "@/lib/finance/format";

import {
  TransferDrawer,
  type BankOption,
  type PendingSettlement,
} from "./transfer-drawer";

// ═══════════════════════════════════════════════════════════════════════════
// Panel arriba de la tabla histórica: settlements en estado 'liquidada' de
// proyectos externos con saldo pendiente > 0. Un botón "Transferir" abre el
// drawer con la RPC atómica.
//
// Este panel filtra en el server (page.tsx) — acá solo pinta la tabla y
// maneja el estado del drawer.
// ═══════════════════════════════════════════════════════════════════════════

export function PendingPanel({
  pending,
  banks,
}: {
  readonly pending: readonly PendingSettlement[];
  readonly banks: readonly BankOption[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId
    ? pending.find((p) => p.id === selectedId) ?? null
    : null;

  if (pending.length === 0) {
    return (
      <EmptyState
        title="No hay liquidaciones pendientes de transferir"
        hint="Cuando se cierre una liquidación de un proyecto externo con saldo a favor del cliente, va a aparecer acá para transferir."
      />
    );
  }

  const columns: Column<PendingSettlement>[] = [
    { key: "project", label: "Proyecto", render: (r) => r.projectName },
    { key: "launch", label: "Lanzamiento", render: (r) => r.launchName },
    {
      key: "closed",
      label: "Cerrada",
      render: (r) => (r.closedAt ? fmtDate(r.closedAt) : "—"),
    },
    {
      key: "pending",
      label: "Saldo pendiente",
      align: "right",
      numeric: true,
      render: (r) => fMoney(r.pending),
    },
    {
      key: "actions",
      label: "",
      align: "right",
      render: (r) => (
        <button
          type="button"
          onClick={() => setSelectedId(r.id)}
          className="kg-focus"
          style={primaryBtnSm}
          title="Transferir al cliente"
        >
          Transferir
        </button>
      ),
    },
  ];

  return (
    <>
      <KgDataTable
        columns={columns}
        rows={pending}
        rowKey={(r) => r.id}
        totalCount={pending.length}
        emptyTitle=""
        emptyHint=""
      />
      {selected && (
        <TransferDrawer
          settlement={selected}
          banks={banks}
          onClose={() => setSelectedId(null)}
        />
      )}
    </>
  );
}

const primaryBtnSm: React.CSSProperties = {
  padding: "5px 12px",
  borderRadius: 999,
  background: "var(--kg-accent-500)",
  color: "#fff",
  border: "none",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
};

function fmtDate(iso: string): string {
  const s = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
