import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { KgDataTable, type Column } from "@/components/kg/data-table";
import { IconFin } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { listBanks, listBankMovements } from "@/lib/banks/list";
import {
  buildBankReport,
  type BankReportBucket,
  type BankReportConsolidated,
} from "@/lib/finance/bank-report";
import { fCount } from "@/lib/finance/format";
import { resolvePeriod, type Period } from "@/lib/finance/period";
import { fmtNative } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

import { RangePills, type PresetOption } from "../../range-pills";

export const metadata: Metadata = { title: "Reporte de bancos · Financiero" };

type RangeParam = "todo" | "mes-actual" | "mes-anterior" | "90d" | "custom";

const RANGE_PRESETS: readonly PresetOption[] = [
  { value: "todo", label: "Todo" },
  { value: "mes-actual", label: "Mes actual" },
  { value: "mes-anterior", label: "Mes anterior" },
  { value: "90d", label: "90 días" },
];

interface MovementSlim {
  readonly id: string;
  readonly bank_id: string;
  readonly kind: "in" | "out";
  readonly amount: number;
  readonly organization_id: string;
  readonly occurred_at: string;
  readonly description: string | null;
  readonly created_by: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export default async function ReporteBancosPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const rangeParam = parseRange(sp.range);
  const fromParam = parseYmd(sp.from);
  const toParam = parseYmd(sp.to);

  const isCustom = fromParam != null && toParam != null;
  const effectiveRange: RangeParam = isCustom ? "custom" : rangeParam;
  const period: Period | null =
    effectiveRange === "todo"
      ? null
      : isCustom
        ? resolvePeriod({ from: fromParam, to: toParam })
        : resolvePeriod({ range: effectiveRange });

  const supabase = await createClient();

  // Trae bancos + movimientos del rango. `listBankMovements` es el select
  // completo con RLS org-scope.
  const [banks, allMovements] = await Promise.all([
    listBanks(),
    listBankMovements(),
  ]);

  const movementsInPeriod = (allMovements as MovementSlim[]).filter((m) => {
    if (!period) return true;
    const ymd = m.occurred_at.slice(0, 10);
    return ymd >= period.fromYmd && ymd <= period.toYmd;
  });

  // Set de movement_ids linkeados a factura / gasto / nómina / transferencia
  // (para el cross-check de conciliación). Factura y gasto usan bridge N:M
  // (0117/0119); nómina y transferencia-a-cliente siguen 1:1 con FK directa
  // en su fila (payroll.bank_movement_id / client_transfers.bank_movement_id).
  const movementIds = movementsInPeriod.map((m) => m.id);
  const [invLinksRes, expLinksRes, payLinksRes, ctLinksRes] = await Promise.all([
    movementIds.length > 0
      ? supabase
          .from("invoice_bank_movements")
          .select("bank_movement_id")
          .in("bank_movement_id", movementIds)
      : Promise.resolve({ data: [] }),
    movementIds.length > 0
      ? supabase
          .from("expense_bank_movements")
          .select("bank_movement_id")
          .in("bank_movement_id", movementIds)
      : Promise.resolve({ data: [] }),
    movementIds.length > 0
      ? supabase
          .from("payroll")
          .select("bank_movement_id")
          .in("bank_movement_id", movementIds)
      : Promise.resolve({ data: [] }),
    movementIds.length > 0
      ? supabase
          .from("client_transfers")
          .select("bank_movement_id")
          .in("bank_movement_id", movementIds)
      : Promise.resolve({ data: [] }),
  ]);
  const linkedMovementIds = new Set<string>();
  for (const r of (invLinksRes.data ?? []) as { bank_movement_id: string }[]) {
    linkedMovementIds.add(r.bank_movement_id);
  }
  for (const r of (expLinksRes.data ?? []) as { bank_movement_id: string }[]) {
    linkedMovementIds.add(r.bank_movement_id);
  }
  for (const r of (payLinksRes.data ?? []) as { bank_movement_id: string | null }[]) {
    if (r.bank_movement_id) linkedMovementIds.add(r.bank_movement_id);
  }
  for (const r of (ctLinksRes.data ?? []) as { bank_movement_id: string | null }[]) {
    if (r.bank_movement_id) linkedMovementIds.add(r.bank_movement_id);
  }

  const report = buildBankReport(banks, movementsInPeriod, linkedMovementIds);

  // ─── Columnas de la tabla por banco ───────────────────────────────────
  const columns: Column<BankReportBucket>[] = [
    { key: "name", label: "Banco", render: (r) => r.bankName },
    { key: "currency", label: "Moneda", render: (r) => r.currency },
    {
      key: "opening",
      label: "Saldo apertura",
      align: "right",
      numeric: true,
      render: (r) => fmtNative(r.opening, r.currency),
    },
    {
      key: "in",
      label: "Ingresos",
      align: "right",
      numeric: true,
      render: (r) => fmtNative(r.movementsIn, r.currency),
    },
    {
      key: "out",
      label: "Egresos",
      align: "right",
      numeric: true,
      render: (r) => fmtNative(-r.movementsOut, r.currency),
    },
    {
      key: "net",
      label: "Neto",
      align: "right",
      numeric: true,
      render: (r) => fmtNative(r.net, r.currency),
    },
    {
      key: "closing",
      label: "Saldo cierre",
      align: "right",
      numeric: true,
      render: (r) => fmtNative(r.closing, r.currency),
    },
    {
      key: "conc",
      label: "Concil.",
      align: "right",
      render: (r) =>
        r.movementCount > 0 ? (
          <span
            style={{
              fontSize: 11,
              color:
                r.unconciledCount > 0
                  ? "#FFB800"
                  : "var(--kg-text-3)",
            }}
            title={`${r.linkedCount} conciliados de ${r.movementCount} movimientos`}
          >
            {r.linkedCount}/{r.movementCount}
          </span>
        ) : (
          "—"
        ),
    },
  ];

  const totalMovements = report.byBank.reduce(
    (a, b) => a + b.movementCount,
    0,
  );
  const totalUnconciled = report.byBank.reduce(
    (a, b) => a + b.unconciledCount,
    0,
  );

  const exportXlsxHref = buildExportHref("xlsx", rangeParam, fromParam, toParam);
  const exportPdfHref = buildExportHref("pdf", rangeParam, fromParam, toParam);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconFin size={16} />}
        title="Reporte de bancos"
        stats={[
          { l: "Bancos", v: fCount(report.byBank.length) },
          { l: "Movimientos en la vista", v: fCount(totalMovements) },
          {
            l: "Sin conciliar",
            v: fCount(totalUnconciled),
            c: totalUnconciled > 0 ? "#FFB800" : undefined,
          },
        ]}
      />

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <RangePills
          presets={RANGE_PRESETS}
          activePreset={isCustom ? null : rangeParam === "custom" ? null : rangeParam}
          activeFrom={period?.fromYmd ?? null}
          activeTo={period?.toYmd ?? null}
          baseHref="/financiero/reportes/bancos"
        />
        <a
          href={exportXlsxHref}
          className="kg-focus"
          style={ghostBtnLg}
          title="Exportar el reporte a Excel"
        >
          Exportar Excel
        </a>
        <a
          href={exportPdfHref}
          target="_blank"
          rel="noopener noreferrer"
          className="kg-focus"
          style={ghostBtnLg}
          title="Descargar el reporte en PDF"
        >
          Exportar PDF
        </a>
      </div>

      <Panel title="Por banco" pad={false}>
        <KgDataTable
          columns={columns}
          rows={report.byBank}
          rowKey={(r) => r.bankId}
          totalCount={report.byBank.length}
          emptyTitle="No hay bancos cargados"
          emptyHint="Cargá al menos un banco desde /financiero/bancos y volvé acá."
        />
      </Panel>

      <Panel title="Consolidado por moneda" pad>
        <ConsolidatedRows rows={report.consolidated} />
      </Panel>
    </div>
  );
}

function ConsolidatedRows({
  rows,
}: {
  readonly rows: readonly BankReportConsolidated[];
}) {
  if (rows.length === 0) {
    return (
      <div style={{ padding: 12, color: "var(--kg-text-3)", fontSize: 12 }}>
        Sin datos para consolidar en este rango.
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {rows.map((c) => (
        <div
          key={c.currency}
          style={{
            display: "grid",
            gridTemplateColumns: "auto repeat(5, 1fr)",
            gap: 12,
            alignItems: "center",
            padding: "10px 12px",
            borderRadius: "var(--kg-r-8)",
            background: "var(--kg-surface-2-solid)",
            border: "1px solid var(--kg-border-subtle)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "3px 10px",
              borderRadius: 999,
              background: "var(--kg-accent-500)",
              color: "#fff",
            }}
          >
            {c.currency}
          </div>
          <StatCell label="Apertura" value={fmtNative(c.opening, c.currency)} />
          <StatCell label="Ingresos" value={fmtNative(c.movementsIn, c.currency)} />
          <StatCell label="Egresos" value={fmtNative(-c.movementsOut, c.currency)} />
          <StatCell
            label="Neto"
            value={fmtNative(c.net, c.currency)}
            positive={c.net >= 0}
          />
          <StatCell label="Cierre" value={fmtNative(c.closing, c.currency)} strong />
        </div>
      ))}
    </div>
  );
}

function StatCell({
  label,
  value,
  strong,
  positive,
}: {
  readonly label: string;
  readonly value: string;
  readonly strong?: boolean;
  readonly positive?: boolean;
}) {
  return (
    <div>
      <div
        className="kg-t7"
        style={{
          color: "var(--kg-text-3)",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 0.4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: strong ? 15 : 13,
          fontWeight: strong ? 800 : 700,
          fontVariantNumeric: "tabular-nums",
          color:
            positive === undefined
              ? "var(--kg-text-1)"
              : positive
                ? "#00D084"
                : "#EF4444",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function buildExportHref(
  format: "xlsx" | "pdf",
  range: RangeParam,
  from: string | null,
  to: string | null,
): string {
  const params = new URLSearchParams();
  if (from && to) {
    params.set("from", from);
    params.set("to", to);
  } else if (range !== "todo") {
    params.set("range", range);
  }
  const qs = params.toString();
  const base =
    format === "pdf"
      ? "/api/financiero/reportes/bancos/export-pdf"
      : "/api/financiero/reportes/bancos/export";
  return qs ? `${base}?${qs}` : base;
}

function parseRange(v: string | string[] | undefined): RangeParam {
  if (typeof v !== "string") return "todo";
  const allowed: RangeParam[] = [
    "todo",
    "mes-actual",
    "mes-anterior",
    "90d",
    "custom",
  ];
  return (allowed as string[]).includes(v) ? (v as RangeParam) : "todo";
}
function parseYmd(v: string | string[] | undefined): string | null {
  if (typeof v !== "string") return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

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
};
