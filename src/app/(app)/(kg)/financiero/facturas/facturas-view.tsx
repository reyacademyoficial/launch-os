"use client";

import type { ReactNode } from "react";
import { useState } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { fMoney } from "@/lib/finance/format";
import type { InvoiceClass } from "@/lib/finance/invoice-classification";

import {
  InvoiceFormDrawer,
  type ProductOption,
  type ProjectOption,
} from "./invoice-form-drawer";
import {
  LinkInvoiceMovementDrawer,
  type UnconciledMovementForInvoice,
} from "./link-invoice-movement-drawer";

// ═══════════════════════════════════════════════════════════════════════════
// Vista client-side de facturas — envuelve la tabla y sus drawers (edit +
// conciliación). El botón "+ Nueva factura" vive en `NewInvoiceButton`
// aparte porque se renderiza como `actions` del Panel (misma fila que el
// título) y el paginador entra como `footerActions` para no ocupar otra
// franja vertical.
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
  unconciledMovements,
  emptyTitle,
  emptyHint,
  footerActions,
}: {
  readonly rows: readonly FacturaRowData[];
  readonly totalCount: number;
  readonly projects: readonly ProjectOption[];
  readonly products: readonly ProductOption[];
  readonly unconciledMovements: readonly UnconciledMovementForInvoice[];
  readonly emptyTitle: string;
  readonly emptyHint: string;
  /** Slot para el paginador — va en la misma fila que "X de Y registros". */
  readonly footerActions?: ReactNode;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const editingRow = editingId
    ? rows.find((r) => r.id === editingId) ?? null
    : null;
  const linkingRow = linkingId
    ? rows.find((r) => r.id === linkingId) ?? null
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
      render: (r) => {
        const canLink = r.status !== "anulada";
        const linkLabel =
          r.linkedMovements.length > 0 ? "Ver conciliación" : "Conciliar";
        return (
          <span style={{ display: "inline-flex", gap: 6 }}>
            <a
              href={`/api/facturas/${r.id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="kg-focus"
              style={{ ...ghostBtn, textDecoration: "none" }}
              title="Descargar remito en PDF"
            >
              Remito
            </a>
            <button
              type="button"
              onClick={() => setLinkingId(r.id)}
              disabled={!canLink}
              className="kg-focus"
              style={{
                ...ghostBtn,
                opacity: canLink ? 1 : 0.5,
                cursor: canLink ? "pointer" : "not-allowed",
              }}
              title={
                canLink
                  ? "Conciliar con uno o más movimientos bancarios"
                  : "Las facturas anuladas no se pueden conciliar"
              }
            >
              {linkLabel}
            </button>
            <button
              type="button"
              onClick={() => setEditingId(r.id)}
              className="kg-focus"
              style={ghostBtn}
              title="Editar factura"
            >
              Editar
            </button>
          </span>
        );
      },
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <KgDataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        totalCount={totalCount}
        emptyTitle={emptyTitle}
        emptyHint={emptyHint}
        // flex-fill: la tabla toma el alto disponible del Panel padre y
        // scrollea internamente sin offsets fijos.
        fillHeight
        footerActions={footerActions}
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

      {linkingRow && (
        <LinkInvoiceMovementDrawer
          invoice={{
            id: linkingRow.id,
            invoiceNumber:
              linkingRow.invoiceNumber === "—" ? null : linkingRow.invoiceNumber,
            description: linkingRow.description,
            amountGross: linkingRow.amountGross,
            currency: linkingRow.currency,
            issueDate: linkingRow.issueDate,
            status: linkingRow.status,
            linkedMovements: linkingRow.linkedMovements,
          }}
          unconciledMovements={unconciledMovements}
          onClose={() => setLinkingId(null)}
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
  const s = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso;
  const d = new Date(s);
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
