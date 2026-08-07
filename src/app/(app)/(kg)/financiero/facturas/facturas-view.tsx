"use client";

import { useState } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { fMoney } from "@/lib/finance/format";
import type { InvoiceClass } from "@/lib/finance/invoice-classification";

import {
  InvoiceFormDrawer,
  type ProductOption,
  type ProjectOption,
} from "./invoice-form-drawer";

// ═══════════════════════════════════════════════════════════════════════════
// Vista client-side de facturas — envuelve la tabla + botón crear + drawer
// de edit. La página server hace el fetch y le pasa las rows serializables.
// ═══════════════════════════════════════════════════════════════════════════

export type InvoiceStatus = "emitida" | "cobrada" | "vencida" | "anulada";

export interface LinkedMovement {
  readonly movementId: string;
  readonly role: "principal" | "comision" | "otro";
  readonly amount: number;
  readonly kind: "in" | "out";
  readonly occurredAt: string;
  readonly description: string | null;
  readonly bankName: string;
}

export interface FacturaRowData {
  readonly id: string;
  readonly issueDate: string;
  readonly invoiceNumber: string;
  readonly projectLabel: string;
  readonly launchLabel: string;
  readonly description: string;
  readonly amountGross: number;
  readonly taxAmount: number;
  readonly amountNet: number;
  readonly status: InvoiceStatus;
  readonly classification: InvoiceClass;
  readonly paidAt: string | null;
  readonly buyerName: string | null;
  readonly transactionNumber: string | null;
  // Campos completos para prepoblar el drawer de edit.
  readonly category: string | null;
  readonly currency: string;
  readonly dueDate: string | null;
  readonly purchaseDate: string | null;
  readonly projectId: string | null;
  readonly saleId: string | null;
  readonly productId: string | null;
  readonly buyerEmail: string | null;
  readonly buyerDocument: string | null;
  readonly notes: string | null;
  // Post 0117 — movimientos linkeados + comisión pasarela derivada.
  readonly linkedMovements: readonly LinkedMovement[];
  /** amount_gross − Σ(principal.amount). null si no hay principal linkeado. */
  readonly gatewayFee: number | null;
}

export function FacturasView({
  rows,
  totalCount,
  projects,
  products,
  emptyTitle,
  emptyHint,
}: {
  readonly rows: readonly FacturaRowData[];
  readonly totalCount: number;
  readonly projects: readonly ProjectOption[];
  readonly products: readonly ProductOption[];
  readonly emptyTitle: string;
  readonly emptyHint: string;
}) {
  const [openCreate, setOpenCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingRow = editingId
    ? rows.find((r) => r.id === editingId) ?? null
    : null;

  const columns: Column<FacturaRowData>[] = [
    { key: "issueDate", label: "Emisión", render: (r) => fmtDate(r.issueDate) },
    { key: "invoiceNumber", label: "Nº", render: (r) => r.invoiceNumber },
    { key: "project", label: "Proyecto", render: (r) => r.projectLabel },
    { key: "launch", label: "Lanzamiento", render: (r) => r.launchLabel },
    {
      key: "description",
      label: "Descripción",
      render: (r) => (
        <span style={ellipsis} title={r.description}>
          {r.description}
        </span>
      ),
    },
    {
      key: "buyer",
      label: "Comprador",
      render: (r) =>
        r.buyerName ? (
          <span style={ellipsis} title={r.buyerName}>
            {r.buyerName}
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "amountGross",
      label: "Bruto",
      align: "right",
      numeric: true,
      render: (r) => fMoney(r.amountGross),
    },
    {
      key: "taxAmount",
      label: "IVA",
      align: "right",
      numeric: true,
      render: (r) => fMoney(r.taxAmount),
    },
    {
      key: "amountNet",
      label: "Neto",
      align: "right",
      numeric: true,
      render: (r) => fMoney(r.amountNet),
    },
    {
      key: "status",
      label: "Estado",
      render: (r) => <StatusPill kind="invoice-status" value={r.status} />,
    },
    {
      key: "classification",
      label: "Clasif.",
      render: (r) => (
        <StatusPill kind="invoice-classification" value={r.classification} />
      ),
    },
    {
      key: "transaction_number",
      label: "Nº transacción",
      render: (r) =>
        r.transactionNumber ? (
          <span style={ellipsis} title={r.transactionNumber}>
            {r.transactionNumber}
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "gateway_fee",
      label: "Comisión pasarela",
      align: "right",
      numeric: true,
      render: (r) =>
        r.gatewayFee != null ? fMoney(r.gatewayFee) : "—",
    },
    {
      key: "actions",
      label: "",
      align: "right",
      render: (r) => (
        <button
          type="button"
          onClick={() => setEditingId(r.id)}
          className="kg-focus"
          style={ghostBtn}
          title="Editar factura"
        >
          Editar
        </button>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          padding: "10px 14px",
          borderBottom: "1px solid var(--kg-border-subtle)",
        }}
      >
        <button
          type="button"
          onClick={() => setOpenCreate(true)}
          className="kg-focus"
          style={{
            padding: "6px 14px",
            borderRadius: 999,
            background: "var(--kg-accent-500)",
            color: "#fff",
            border: "none",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          + Nueva factura
        </button>
      </div>

      <KgDataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        totalCount={totalCount}
        emptyTitle={emptyTitle}
        emptyHint={emptyHint}
      />

      <InvoiceFormDrawer
        mode="create"
        open={openCreate}
        onClose={() => setOpenCreate(false)}
        projects={projects}
        products={products}
      />

      {editingRow && (
        <InvoiceFormDrawer
          mode="edit"
          open
          onClose={() => setEditingId(null)}
          projects={projects}
          products={products}
          linkedMovements={editingRow.linkedMovements}
          gatewayFee={editingRow.gatewayFee}
          initial={{
            id: editingRow.id,
            invoiceNumber: editingRow.invoiceNumber,
            status: editingRow.status,
            projectId: editingRow.projectId,
            saleId: editingRow.saleId,
            productId: editingRow.productId,
            description: editingRow.description,
            category: editingRow.category,
            amountGross: editingRow.amountGross,
            taxAmount: editingRow.taxAmount,
            currency: editingRow.currency,
            issueDate: editingRow.issueDate,
            dueDate: editingRow.dueDate,
            purchaseDate: editingRow.purchaseDate,
            buyerName: editingRow.buyerName,
            buyerEmail: editingRow.buyerEmail,
            buyerDocument: editingRow.buyerDocument,
            transactionNumber: editingRow.transactionNumber,
            notes: editingRow.notes,
          }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Presentación — mismos pills que la versión previa server-side
// ═══════════════════════════════════════════════════════════════════════════

function StatusPill({
  kind,
  value,
}: {
  readonly kind: "invoice-status" | "invoice-classification";
  readonly value: InvoiceStatus | InvoiceClass;
}) {
  const spec = pillSpec(kind, value);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        background: spec.bg,
        color: spec.fg,
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: spec.dot,
          display: "inline-block",
        }}
      />
      {spec.label}
    </span>
  );
}

function pillSpec(
  kind: "invoice-status" | "invoice-classification",
  value: string,
): { label: string; bg: string; fg: string; dot: string } {
  const neutral = {
    bg: "rgba(138,138,153,0.15)",
    fg: "var(--kg-text-2)",
    dot: "#8A8A99",
  };
  const positive = { bg: "rgba(0,208,132,0.15)", fg: "#00D084", dot: "#00D084" };
  const warning = { bg: "rgba(255,184,0,0.15)", fg: "#FFB800", dot: "#FFB800" };
  const negative = { bg: "rgba(239,68,68,0.15)", fg: "#EF4444", dot: "#EF4444" };
  const accent = {
    bg: "rgba(64,120,255,0.15)",
    fg: "#4078FF",
    dot: "#4078FF",
  };

  if (kind === "invoice-status") {
    if (value === "cobrada") return { label: "Cobrada", ...positive };
    if (value === "emitida") return { label: "Emitida", ...neutral };
    if (value === "vencida") return { label: "Vencida", ...warning };
    if (value === "anulada") return { label: "Anulada", ...negative };
  } else {
    if (value === "kingrow-income")
      return { label: "Ingreso Kingrow", ...accent };
    if (value === "group-volume") return { label: "Volumen grupo", ...neutral };
    if (value === "third-party") return { label: "Terceros", ...neutral };
  }
  return { label: value, ...neutral };
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

const ellipsis: React.CSSProperties = {
  display: "inline-block",
  maxWidth: 240,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  verticalAlign: "middle",
};

const ghostBtn: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
};
