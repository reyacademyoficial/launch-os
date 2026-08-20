"use client";

import type { ReactNode } from "react";
import { useMemo, useState, useTransition } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { fMoney } from "@/lib/finance/format";

import { linkInvoiceToMovement } from "../facturas/actions";
import { bulkDeleteBankMovements } from "./actions";
import {
  MovementDetailDrawer,
} from "./movement-detail-drawer";
import type { BankOption } from "./movement-form-drawer";

// ═══════════════════════════════════════════════════════════════════════════
// Modelo serializable para la fila.
//
// `conciliations` es la lista completa de vínculos del movimiento con las 4
// tablas satélite (invoice_bank_movements, expense_bank_movements, payroll,
// client_transfers). El drawer de detalle las renderiza todas con link al
// módulo de origen. Si la lista es vacía, el movimiento está SIN CONCILIAR.
// ═══════════════════════════════════════════════════════════════════════════

export type MovementConciliation =
  | {
      readonly kind: "invoice";
      readonly id: string;
      readonly role: "principal" | "comision" | "otro";
      readonly label: string;
      readonly amount: number;
    }
  | {
      readonly kind: "expense";
      readonly id: string;
      readonly role: "principal" | "comision" | "otro";
      readonly label: string;
      readonly amount: number;
    }
  | {
      readonly kind: "payroll";
      readonly id: string;
      readonly role: "principal" | "comision" | "otro";
      readonly label: string;
      readonly amount: number;
    }
  | {
      readonly kind: "transfer";
      readonly id: string;
      readonly role: "principal" | "comision" | "otro";
      readonly label: string;
      readonly amount: number;
    };

export interface MovementRowData {
  readonly id: string;
  readonly bankId: string;
  readonly bankName: string;
  /** Moneda del banco al que pertenece — un movimiento no tiene moneda propia. */
  readonly bankCurrency: "ARS" | "USD";
  readonly projectName: string;
  readonly kind: "in" | "out";
  readonly amount: number;
  readonly occurredAt: string;
  readonly description: string;
  readonly transactionNumber: string | null;
  readonly invoiceLink:
    | null
    | {
        readonly kind: "linked";
        readonly invoiceId: string;
        readonly invoiceNumber: string | null;
        readonly role: "principal" | "comision" | "otro";
      }
    | {
        readonly kind: "suggested";
        readonly invoiceId: string;
        readonly invoiceNumber: string | null;
      };
  readonly conciliations: readonly MovementConciliation[];
}

export function MovimientosView({
  rows,
  totalCount,
  banks,
  footerActions,
}: {
  readonly rows: readonly MovementRowData[];
  readonly totalCount: number;
  readonly banks: readonly BankOption[];
  /** Slot para el paginador — va en la misma fila que "X de Y registros". */
  readonly footerActions?: ReactNode;
}) {
  const [detailId, setDetailId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkPending, startBulk] = useTransition();

  const detailRow = detailId
    ? rows.find((r) => r.id === detailId) ?? null
    : null;

  const visibleIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someVisibleSelected =
    !allVisibleSelected && visibleIds.some((id) => selected.has(id));
  const selectedCount = selected.size;

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set<string>());
  }

  function handleBulkDelete() {
    if (selectedCount === 0) return;
    const msg =
      `¿Eliminar ${selectedCount} movimiento(s) bancarios?\n\n` +
      `Se van a romper todas sus conciliaciones: facturas y gastos linkeados ` +
      `quedarán marcados como IMPAGOS; nóminas y transferencias a cliente ` +
      `perderán la referencia al pago.\n\n` +
      `Esta acción es IRREVERSIBLE.`;
    if (!confirm(msg)) return;
    const ids = Array.from(selected);
    setBulkError(null);
    startBulk(async () => {
      const r = await bulkDeleteBankMovements(ids);
      if ("error" in r) {
        setBulkError(r.error);
      } else {
        clearSelection();
      }
    });
  }

  const columns: Column<MovementRowData>[] = [
    {
      key: "select",
      label: (
        <input
          type="checkbox"
          checked={allVisibleSelected}
          ref={(el) => {
            if (el) el.indeterminate = someVisibleSelected;
          }}
          disabled={rows.length === 0}
          onChange={toggleAllVisible}
          aria-label="Seleccionar movimientos visibles"
          title="Seleccionar todos los movimientos visibles en esta página"
        />
      ),
      width: "36px",
      render: (r) => (
        <input
          type="checkbox"
          checked={selected.has(r.id)}
          onChange={() => toggleRow(r.id)}
          aria-label={`Seleccionar movimiento del ${fmtDate(r.occurredAt)}`}
        />
      ),
    },
    { key: "date", label: "Fecha", render: (r) => fmtDate(r.occurredAt) },
    {
      key: "bank",
      label: "Banco",
      render: (r) => (
        <span>
          {r.bankName}{" "}
          <span
            style={{
              padding: "1px 6px",
              borderRadius: 999,
              background:
                r.bankCurrency === "USD"
                  ? "rgba(0,208,132,0.15)"
                  : "rgba(138,138,153,0.15)",
              color:
                r.bankCurrency === "USD" ? "#00D084" : "var(--kg-text-3)",
              fontSize: 10,
              fontWeight: 700,
              marginLeft: 4,
            }}
            title={`Movimiento en ${r.bankCurrency}`}
          >
            {r.bankCurrency}
          </span>
        </span>
      ),
    },
    { key: "project", label: "Proyecto", render: (r) => r.projectName },
    {
      key: "kind",
      label: "Tipo",
      render: (r) => <KindPill kind={r.kind} />,
    },
    {
      key: "amount",
      label: "Monto",
      align: "right",
      numeric: true,
      // Salidas con signo negativo. El color va por la pill, no por el número.
      // La moneda aparece como sufijo — sin él ARS 1000 y USD 1000 se
      // confunden y arruinan la conciliación.
      render: (r) => (
        <span>
          {r.kind === "out" ? fMoney(-r.amount) : fMoney(r.amount)}{" "}
          <span
            style={{
              fontSize: 10,
              color: "var(--kg-text-3)",
              fontWeight: 500,
            }}
          >
            {r.bankCurrency}
          </span>
        </span>
      ),
    },
    {
      key: "description",
      label: "Descripción",
      render: (r) =>
        r.description ? (
          <span title={r.description} style={ellipsis}>
            {r.description}
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "conciliation",
      label: "Conciliación",
      render: (r) => <ConciliationCell row={r} />,
    },
    {
      key: "actions",
      label: "",
      align: "right",
      render: (r) => (
        <button
          type="button"
          onClick={() => setDetailId(r.id)}
          className="kg-focus"
          style={ghostBtn}
          title="Ver ficha del movimiento"
        >
          Ver ficha
        </button>
      ),
    },
  ];

  // Bar de selección: sólo aparece cuando hay filas marcadas. La checkbox
  // "seleccionar visibles" vive en el header de la columna de check, evitando
  // ocupar una franja permanente cuando no se usa.
  const selectionBar =
    selectedCount > 0 ? (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 14px",
          borderBottom: "1px solid var(--kg-border-subtle)",
          fontSize: 12,
          color: "var(--kg-text-2)",
          flexWrap: "wrap",
        }}
      >
        <span style={{ color: "var(--kg-text-3)" }}>
          {selectedCount} seleccionado(s)
        </span>
        <button
          type="button"
          onClick={clearSelection}
          className="kg-focus"
          style={ghostBtn}
          title="Deseleccionar todos"
        >
          Limpiar
        </button>
        <button
          type="button"
          onClick={handleBulkDelete}
          disabled={bulkPending}
          className="kg-focus"
          style={{
            padding: "6px 14px",
            borderRadius: 999,
            background: "#EF4444",
            color: "#fff",
            border: "none",
            fontSize: 12,
            fontWeight: 700,
            cursor: bulkPending ? "wait" : "pointer",
            opacity: bulkPending ? 0.6 : 1,
          }}
          title="Borrar los movimientos seleccionados. Rompe todas sus conciliaciones."
        >
          {bulkPending
            ? "Borrando…"
            : `Borrar ${selectedCount} seleccionado(s)`}
        </button>
        {bulkError && (
          <span
            style={{ color: "#EF4444", fontSize: 11 }}
            title={bulkError}
          >
            ⚠ {bulkError}
          </span>
        )}
      </div>
    ) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {selectionBar}

      <KgDataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        totalCount={totalCount}
        emptyTitle="No hay movimientos bancarios cargados"
        emptyHint="Los movimientos alimentan el KPI Flujo de caja del dashboard. Cobros de ventas NO se duplican acá — viven en payments; esta tabla es para ingresos/egresos manuales (gastos, retiros, transferencias, ajustes)."
        maxBodyHeight="calc(100vh - 230px)"
        footerActions={footerActions}
      />

      {detailRow && (
        <MovementDetailDrawer
          row={detailRow}
          banks={banks}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Celda "Conciliación"
//
// Prioridad de render:
//   1. Hay conciliaciones → chip resumen ("Factura F-001", "Gasto ...",
//      "+2 más" si son varias). No mostramos monto — el drawer detalla.
//   2. Sin conciliar + sugerencia por transaction_number → chip "Sugerido"
//      con botón Vincular (comportamiento heredado).
//   3. Sin conciliar y sin sugerencia → chip "Sin conciliar" ámbar (para que
//      el usuario lo detecte al scannear la tabla).
// ═══════════════════════════════════════════════════════════════════════════

function ConciliationCell({ row }: { readonly row: MovementRowData }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (row.conciliations.length > 0) {
    const first = row.conciliations[0]!;
    const rest = row.conciliations.length - 1;
    return (
      <span
        title={row.conciliations.map(describe).join(" · ")}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
        }}
      >
        <ConciliationBadge conciliation={first} />
        {rest > 0 && (
          <span
            style={{
              padding: "1px 6px",
              borderRadius: 999,
              background: "rgba(138,138,153,0.15)",
              color: "var(--kg-text-3)",
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            +{rest}
          </span>
        )}
      </span>
    );
  }

  const link = row.invoiceLink;
  if (link && link.kind === "suggested") {
    const suggestedInvoiceId = link.invoiceId;
    function handleLink() {
      setError(null);
      startTransition(async () => {
        const r = await linkInvoiceToMovement(
          suggestedInvoiceId,
          row.id,
          "principal",
        );
        if ("error" in r) setError(r.error);
      });
    }
    return (
      <span
        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        title={
          error ??
          `Match por Nº transacción con la factura ${link.invoiceNumber ?? "—"}. Al vincular, la factura pasa a 'cobrada'.`
        }
      >
        <span style={{ fontSize: 11 }}>
          {link.invoiceNumber ?? "—"}{" "}
          <span
            style={{
              padding: "1px 6px",
              borderRadius: 999,
              background: "rgba(255,184,0,0.15)",
              color: "#FFB800",
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            Sugerido
          </span>
        </span>
        <button
          type="button"
          onClick={handleLink}
          disabled={pending}
          className="kg-focus"
          style={{
            padding: "3px 10px",
            borderRadius: 999,
            background: "var(--kg-accent-500)",
            color: "#fff",
            border: "none",
            fontSize: 10,
            fontWeight: 700,
            cursor: pending ? "wait" : "pointer",
            opacity: pending ? 0.6 : 1,
          }}
        >
          {pending ? "…" : "Vincular"}
        </button>
        {error && (
          <span style={{ color: "#EF4444", fontSize: 10 }} title={error}>
            ⚠
          </span>
        )}
      </span>
    );
  }

  return (
    <span
      title="Este movimiento no está atado a ninguna factura, gasto, nómina ni transferencia. Puede ser un ajuste manual — o un error a corregir."
      style={{
        padding: "2px 8px",
        borderRadius: 999,
        background: "rgba(255,184,0,0.12)",
        color: "#FFB800",
        fontSize: 10,
        fontWeight: 700,
      }}
    >
      Sin conciliar
    </span>
  );
}

function ConciliationBadge({
  conciliation,
}: {
  readonly conciliation: MovementConciliation;
}) {
  const label = describeShort(conciliation);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        maxWidth: 240,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      <TypeChip kind={conciliation.kind} />
      <span
        style={{
          color: "var(--kg-text-1)",
          fontSize: 11,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    </span>
  );
}

function TypeChip({
  kind,
}: {
  readonly kind: MovementConciliation["kind"];
}) {
  const map: Record<MovementConciliation["kind"], { label: string; bg: string; fg: string }> = {
    invoice: { label: "F", bg: "rgba(0,208,132,0.18)", fg: "#00D084" },
    expense: { label: "G", bg: "rgba(239,68,68,0.18)", fg: "#EF4444" },
    payroll: { label: "N", bg: "rgba(64,120,255,0.18)", fg: "#4078FF" },
    transfer: { label: "T", bg: "rgba(255,184,0,0.18)", fg: "#FFB800" },
  };
  const s = map[kind];
  return (
    <span
      title={typeLabel(kind)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 16,
        height: 16,
        borderRadius: 4,
        background: s.bg,
        color: s.fg,
        fontSize: 9,
        fontWeight: 800,
      }}
    >
      {s.label}
    </span>
  );
}

function typeLabel(kind: MovementConciliation["kind"]): string {
  return kind === "invoice"
    ? "Factura"
    : kind === "expense"
      ? "Gasto"
      : kind === "payroll"
        ? "Nómina"
        : "Transferencia a cliente";
}

function describe(c: MovementConciliation): string {
  const base = `${typeLabel(c.kind)}: ${c.label}`;
  return c.role === "principal" ? base : `${base} (${c.role})`;
}

function describeShort(c: MovementConciliation): string {
  return c.label;
}

const ellipsis: React.CSSProperties = {
  display: "inline-block",
  maxWidth: 360,
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

function KindPill({ kind }: { readonly kind: "in" | "out" }) {
  const positive = kind === "in";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        background: positive
          ? "rgba(0,208,132,0.15)"
          : "rgba(239,68,68,0.15)",
        color: positive ? "#00D084" : "#EF4444",
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: positive ? "#00D084" : "#EF4444",
          display: "inline-block",
        }}
      />
      {positive ? "Entrada" : "Salida"}
    </span>
  );
}
