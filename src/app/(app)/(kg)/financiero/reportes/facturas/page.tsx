import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { KgDataTable, type Column } from "@/components/kg/data-table";
import { IconFin } from "@/components/kg/icons";
import { KgPageFilters } from "@/components/kg/page-menu";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { fCount, fMoney } from "@/lib/finance/format";
import {
  buildInvoiceReport,
  type InvoiceInput,
  type InvoiceReportBucket,
  type InvoiceReportDetailRow,
} from "@/lib/finance/invoice-report";
import { resolvePeriod, type Period } from "@/lib/finance/period";
import { fmtNative } from "@/lib/money";
import { getKgProjects } from "@/lib/kg/reference";
import { createClient } from "@/lib/supabase/server";

import { RangePills, type PresetOption } from "../../range-pills";

export const metadata: Metadata = { title: "Reporte de facturas · Financiero" };

const PAGE_SIZE = 100;
type StatusFilter = "todos" | "emitida" | "cobrada" | "vencida" | "anulada";
type RangeParam = "todo" | "mes-actual" | "mes-anterior" | "90d" | "custom";

const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: "todos", label: "Todos" },
  { value: "emitida", label: "Emitidas" },
  { value: "cobrada", label: "Cobradas" },
  { value: "vencida", label: "Vencidas" },
  { value: "anulada", label: "Anuladas" },
];

const RANGE_PRESETS: readonly PresetOption[] = [
  { value: "todo", label: "Todo" },
  { value: "mes-actual", label: "Mes actual" },
  { value: "mes-anterior", label: "Mes anterior" },
  { value: "90d", label: "90 días" },
];

interface InvoiceDbRow {
  readonly id: string;
  readonly status: "emitida" | "cobrada" | "vencida" | "anulada";
  readonly issue_date: string;
  readonly due_date: string | null;
  readonly amount_gross: number;
  readonly currency: string | null;
  readonly project_id: string | null;
  readonly invoice_number: string | null;
  readonly buyer_name: string | null;
  readonly description: string;
}

interface BridgeSlim {
  readonly invoice_id: string;
  readonly bank_movements: { amount: number; kind: "in" | "out" } | null;
}

export default async function ReporteFacturasPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const statusParam = parseStatus(sp.status);
  const projectFilter =
    typeof sp.project === "string" && sp.project.length > 0 ? sp.project : null;
  const rangeParam = parseRange(sp.range);
  const fromParam = parseYmd(sp.from);
  const toParam = parseYmd(sp.to);
  const page = parsePage(sp.page);

  const isCustom = fromParam != null && toParam != null;
  const effectiveRange: RangeParam = isCustom ? "custom" : rangeParam;
  const period: Period | null =
    effectiveRange === "todo"
      ? null
      : isCustom
        ? resolvePeriod({ from: fromParam, to: toParam })
        : resolvePeriod({ range: effectiveRange });

  const supabase = await createClient();

  let query = supabase
    .from("invoices")
    .select(
      "id, status, issue_date, due_date, amount_gross, currency, project_id, invoice_number, buyer_name, description",
    )
    .order("issue_date", { ascending: false });
  if (period) {
    query = query
      .gte("issue_date", period.fromYmd)
      .lte("issue_date", period.toYmd);
  }
  if (projectFilter) query = query.eq("project_id", projectFilter);

  const [invRes, allProjects] = await Promise.all([
    query,
    getKgProjects(),
  ]);
  const rawInvoices = (invRes.data ?? []) as unknown as InvoiceDbRow[];

  // Bridge principal por factura → suma para derivar gateway_fee.
  const invoiceIds = rawInvoices.map((i) => i.id);
  let principalSum = new Map<string, number>();
  if (invoiceIds.length > 0) {
    const bridgeRes = await supabase
      .from("invoice_bank_movements")
      .select("invoice_id, bank_movements!inner(amount, kind)")
      .eq("role", "principal")
      .in("invoice_id", invoiceIds);
    const bridgeRows = (bridgeRes.data ?? []) as unknown as BridgeSlim[];
    for (const b of bridgeRows) {
      if (!b.bank_movements || b.bank_movements.kind !== "in") continue;
      principalSum.set(
        b.invoice_id,
        (principalSum.get(b.invoice_id) ?? 0) + Number(b.bank_movements.amount),
      );
    }
  }

  // Normalizamos moneda al build (nunca sumamos ARS + USD).
  const normalized: InvoiceInput[] = rawInvoices.map((i) => ({
    id: i.id,
    status: i.status,
    issue_date: i.issue_date,
    due_date: i.due_date,
    amount_gross: Number(i.amount_gross),
    currency: i.currency ?? "ARS",
    project_id: i.project_id,
    invoice_number: i.invoice_number,
    buyer_name: i.buyer_name,
    description: i.description,
  }));

  const todayYmd = new Date().toISOString().slice(0, 10);
  const report = buildInvoiceReport(normalized, principalSum, todayYmd);

  // Filtro de status (post-build para respetar la reclasificación 'vencida').
  const filteredDetail =
    statusParam === "todos"
      ? report.detail
      : report.detail.filter((r) => r.status === statusParam);

  const totalCount = filteredDetail.length;
  const start = (page - 1) * PAGE_SIZE;
  const paged = filteredDetail.slice(start, start + PAGE_SIZE);

  const projectNameById = new Map<string, string>(
    allProjects.map((p) => [p.id, p.name]),
  );
  const projectsWithInvoices = new Set(
    rawInvoices
      .map((i) => i.project_id)
      .filter((id): id is string => id != null),
  );

  const projectPills = [
    {
      label: "Todos los proyectos",
      href: buildHref({ project: null }),
      active: projectFilter == null,
    },
    ...allProjects
      .filter((p) => projectsWithInvoices.has(p.id))
      .map((p) => ({
        label: p.name,
        href: buildHref({ project: p.id }),
        active: projectFilter === p.id,
      })),
  ];

  const columns: Column<InvoiceReportDetailRow>[] = [
    {
      key: "issueDate",
      label: "Emisión",
      render: (r) => fmtDate(r.issueDate),
    },
    {
      key: "invoiceNumber",
      label: "Nº",
      render: (r) => r.invoiceNumber ?? "—",
    },
    {
      key: "project",
      label: "Proyecto",
      render: (r) =>
        r.projectId ? projectNameById.get(r.projectId) ?? "—" : "Sin proyecto",
    },
    {
      key: "buyer",
      label: "Comprador",
      render: (r) => r.buyerName ?? "—",
    },
    {
      key: "status",
      label: "Estado",
      render: (r) => <StatusPill status={r.status} />,
    },
    {
      key: "amount",
      label: "Monto",
      align: "right",
      numeric: true,
      render: (r) => fmtNative(r.amountGross, r.currency as "ARS" | "USD"),
    },
    {
      key: "gatewayFee",
      label: "Comisión",
      align: "right",
      numeric: true,
      render: (r) =>
        r.gatewayFee != null
          ? fmtNative(r.gatewayFee, r.currency as "ARS" | "USD")
          : "—",
    },
    {
      key: "dueDate",
      label: "Vence",
      render: (r) => (r.dueDate ? fmtDate(r.dueDate) : "—"),
    },
  ];

  const exportXlsxHref = buildExportHref({
    format: "xlsx",
    status: statusParam,
    project: projectFilter,
    range: rangeParam,
    from: fromParam,
    to: toParam,
  });
  const exportPdfHref = buildExportHref({
    format: "pdf",
    status: statusParam,
    project: projectFilter,
    range: rangeParam,
    from: fromParam,
    to: toParam,
  });

  const totalMonto = filteredDetail.reduce((a, r) => a + r.amountGross, 0);

  function buildHref(overrides: {
    status?: StatusFilter;
    project?: string | null;
    page?: number;
  }): string {
    const nextStatus = overrides.status ?? statusParam;
    const nextProject =
      overrides.project !== undefined ? overrides.project : projectFilter;
    const nextPage = overrides.page ?? page;
    const params = new URLSearchParams();
    if (nextStatus !== "todos") params.set("status", nextStatus);
    if (nextProject) params.set("project", nextProject);
    if (isCustom && fromParam && toParam) {
      params.set("from", fromParam);
      params.set("to", toParam);
    } else if (rangeParam !== "todo") {
      params.set("range", rangeParam);
    }
    if (nextPage > 1) params.set("page", String(nextPage));
    const qs = params.toString();
    return qs
      ? `/financiero/reportes/facturas?${qs}`
      : "/financiero/reportes/facturas";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconFin size={16} />}
        title="Reporte de facturas"
        stats={[
          { l: "Total en la vista", v: fCount(totalCount) },
          { l: "Monto total (mixto)", v: fMoney(totalMonto) },
        ]}
      />

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <KgPageFilters
          activeCount={
            (statusParam !== "todos" ? 1 : 0) +
            (rangeParam !== "todo" || (period?.fromYmd && period?.toYmd)
              ? 1
              : 0)
          }
        >
          <KgParamPills
            ariaLabel="Filtrar por estado"
            options={STATUS_OPTIONS.map((o) => ({
              label: o.label,
              href: buildHref({ status: o.value, page: 1 }),
              active: statusParam === o.value,
            }))}
          />
          <RangePills
            presets={RANGE_PRESETS}
            activePreset={isCustom ? null : rangeParam === "custom" ? null : rangeParam}
            activeFrom={period?.fromYmd ?? null}
            activeTo={period?.toYmd ?? null}
            baseHref="/financiero/reportes/facturas"
          />
        </KgPageFilters>
        <span className="hidden md:contents">
          <a
            href={exportXlsxHref}
            className="kg-focus"
            style={ghostBtnLg}
            title="Exportar el reporte a Excel"
          >
            Exportar Excel
          </a>
        </span>
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

      {projectPills.length > 1 && (
        <KgPageFilters activeCount={projectFilter != null ? 1 : 0}>
          <KgParamPills
            ariaLabel="Filtrar por proyecto"
            options={projectPills}
          />
        </KgPageFilters>
      )}

      <Panel title="Totales por estado y moneda" pad>
        <BucketsGrid buckets={report.buckets} />
      </Panel>

      <Panel title="Detalle" pad={false}>
        <KgDataTable
          columns={columns}
          rows={paged}
          rowKey={(r) => r.id}
          totalCount={totalCount}
          emptyTitle="No hay facturas en la vista"
          emptyHint="Ajustá el rango o el estado para ver otro subconjunto. Todas las facturas se cargan en /financiero/facturas."
        />
      </Panel>
    </div>
  );
}

function BucketsGrid({
  buckets,
}: {
  readonly buckets: readonly InvoiceReportBucket[];
}) {
  if (buckets.length === 0) {
    return (
      <div style={{ padding: 12, color: "var(--kg-text-3)", fontSize: 12 }}>
        Sin facturas en este rango.
      </div>
    );
  }
  // Orden fijo: cobrada / emitida / vencida / anulada, ARS antes que USD.
  const orderStatus: Record<InvoiceReportBucket["status"], number> = {
    cobrada: 0,
    emitida: 1,
    vencida: 2,
    anulada: 3,
  };
  const sorted = [...buckets].sort(
    (a, b) =>
      orderStatus[a.status] - orderStatus[b.status] ||
      a.currency.localeCompare(b.currency),
  );
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: 10,
      }}
    >
      {sorted.map((b) => {
        const spec = statusColor(b.status);
        return (
          <div
            key={`${b.status}-${b.currency}`}
            style={{
              padding: 12,
              borderRadius: "var(--kg-r-8)",
              background: "var(--kg-surface-2-solid)",
              border: "1px solid var(--kg-border-subtle)",
              borderLeftWidth: 4,
              borderLeftColor: spec.dot,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 4,
              }}
            >
              <span
                style={{
                  color: spec.fg,
                  fontWeight: 700,
                  fontSize: 12,
                  textTransform: "uppercase",
                  letterSpacing: 0.4,
                }}
              >
                {spec.label}
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: "var(--kg-text-3)",
                  fontWeight: 700,
                }}
              >
                {b.currency}
              </span>
            </div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 800,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {fmtNative(b.amountGross, b.currency as "ARS" | "USD")}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--kg-text-3)",
                marginTop: 4,
              }}
            >
              {b.count} factura{b.count === 1 ? "" : "s"}
              {b.gatewayFee > 0 && (
                <>
                  {" · "}Comisión pasarela{" "}
                  {fmtNative(b.gatewayFee, b.currency as "ARS" | "USD")}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatusPill({
  status,
}: {
  readonly status: InvoiceReportDetailRow["status"];
}) {
  const spec = statusColor(status);
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

function statusColor(status: InvoiceReportDetailRow["status"]): {
  label: string;
  bg: string;
  fg: string;
  dot: string;
} {
  if (status === "cobrada") {
    return {
      label: "Cobrada",
      bg: "rgba(0,208,132,0.15)",
      fg: "#00D084",
      dot: "#00D084",
    };
  }
  if (status === "vencida") {
    return {
      label: "Vencida",
      bg: "rgba(255,184,0,0.15)",
      fg: "#FFB800",
      dot: "#FFB800",
    };
  }
  if (status === "anulada") {
    return {
      label: "Anulada",
      bg: "rgba(239,68,68,0.15)",
      fg: "#EF4444",
      dot: "#EF4444",
    };
  }
  return {
    label: "Emitida",
    bg: "rgba(138,138,153,0.15)",
    fg: "var(--kg-text-2)",
    dot: "#8A8A99",
  };
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

function buildExportHref(o: {
  format: "xlsx" | "pdf";
  status: StatusFilter;
  project: string | null;
  range: RangeParam;
  from: string | null;
  to: string | null;
}): string {
  const params = new URLSearchParams();
  if (o.status !== "todos") params.set("status", o.status);
  if (o.project) params.set("project", o.project);
  if (o.from && o.to) {
    params.set("from", o.from);
    params.set("to", o.to);
  } else if (o.range !== "todo") {
    params.set("range", o.range);
  }
  const qs = params.toString();
  const base =
    o.format === "pdf"
      ? "/api/financiero/reportes/facturas/export-pdf"
      : "/api/financiero/reportes/facturas/export";
  return qs ? `${base}?${qs}` : base;
}

function parseStatus(v: string | string[] | undefined): StatusFilter {
  if (typeof v !== "string") return "todos";
  const allowed: StatusFilter[] = [
    "todos",
    "emitida",
    "cobrada",
    "vencida",
    "anulada",
  ];
  return (allowed as string[]).includes(v) ? (v as StatusFilter) : "todos";
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
function parsePage(v: string | string[] | undefined): number {
  if (typeof v !== "string") return 1;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
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
