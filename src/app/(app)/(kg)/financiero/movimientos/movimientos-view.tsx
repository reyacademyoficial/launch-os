"use client";

import { useState, useTransition } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { fMoney } from "@/lib/finance/format";

import { linkInvoiceToMovement } from "../facturas/actions";
import { ImportMovementsButton } from "./import-drawer";
import {
  MovementDetailDrawer,
} from "./movement-detail-drawer";
import {
  MovementFormDrawer,
  type BankOption,
} from "./movement-form-drawer";

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
      readonly label: string;
      readonly amount: number;
    }
  | {
      readonly kind: "transfer";
      readonly id: string;
      readonly label: string;
      readonly amount: number;
    };

export interface MovementRowData {
  readonly id: string;
  readonly bankId: string;
  readonly bankName: string;
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
  exportHref,
}: {
  readonly rows: readonly MovementRowData[];
  readonly totalCount: number;
  readonly banks: readonly BankOption[];
  readonly exportHref: string;
}) {
  const [openCreate, setOpenCreate] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const detailRow = detailId
    ? rows.find((r) => r.id === detailId) ?? null
    : null;

  const columns: Column<MovementRowData>[] = [
    { key: "date", label: "Fecha", render: (r) => fmtDate(r.occurredAt) },
    { key: "bank", label: "Banco", render: (r) => r.bankName },
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
      render: (r) => (r.kind === "out" ? fMoney(-r.amount) : fMoney(r.amount)),
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

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          padding: "10px 14px",
          borderBottom: "1px solid var(--kg-border-subtle)",
        }}
      >
        <a
          href={exportHref}
          className="kg-focus"
          style={ghostBtnLg}
          title="Exportar la vista actual a Excel"
        >
          Exportar Excel
        </a>
        <ImportMovementsButton banks={banks} />
        <button
          type="button"
          onClick={() => setOpenCreate(true)}
          disabled={banks.length === 0}
          className="kg-focus"
          style={{
            padding: "6px 14px",
            borderRadius: 999,
            background: "var(--kg-accent-500)",
            color: "#fff",
            border: "none",
            fontSize: 12,
            fontWeight: 700,
            cursor: banks.length === 0 ? "not-allowed" : "pointer",
            opacity: banks.length === 0 ? 0.5 : 1,
          }}
          title={
            banks.length === 0
              ? "Necesitás al menos un banco activo para cargar movimientos"
              : "Crear un movimiento"
          }
        >
          + Nuevo movimiento
        </button>
      </div>

      <KgDataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        totalCount={totalCount}
        emptyTitle="No hay movimientos bancarios cargados"
        emptyHint="Los movimientos alimentan el KPI Flujo de caja del dashboard. Cobros de ventas NO se duplican acá — viven en payments; esta tabla es para ingresos/egresos manuales (gastos, retiros, transferencias, ajustes)."
      />

      <MovementFormDrawer
        mode="create"
        open={openCreate}
        onClose={() => setOpenCreate(false)}
        banks={banks}
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
  if (c.kind === "invoice" || c.kind === "expense") {
    return c.role === "principal" ? base : `${base} (${c.role})`;
  }
  return base;
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

const ghostBtnLg: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
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
