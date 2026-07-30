import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { KgDataTable, type Column } from "@/components/kg/data-table";
import { IconFin } from "@/components/kg/icons";
import { KgPaginator } from "@/components/kg/paginator";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { fCount, fMoney } from "@/lib/finance/format";
import {
  classifyInvoice,
  type InvoiceClass,
  type Ownership,
} from "@/lib/finance/invoice-classification";
import { inPeriodDate, resolvePeriod, type Period } from "@/lib/finance/period";
import type { FinanceInvoiceRow } from "@/lib/finance/types";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Facturas · Financiero" };

// ═══════════════════════════════════════════════════════════════════════════
// Configuración del listado
// ═══════════════════════════════════════════════════════════════════════════

const PAGE_SIZE = 50;

type InvoiceStatus = "emitida" | "cobrada" | "vencida" | "anulada";
type StatusParam = InvoiceStatus | "todos";
type RangeParam = "todo" | "mes-actual" | "mes-anterior" | "90d";

const STATUS_OPTIONS: ReadonlyArray<{
  readonly value: StatusParam;
  readonly label: string;
}> = [
  { value: "todos", label: "Todos" },
  { value: "emitida", label: "Emitidas" },
  { value: "cobrada", label: "Cobradas" },
  { value: "vencida", label: "Vencidas" },
  { value: "anulada", label: "Anuladas" },
];

const RANGE_OPTIONS: ReadonlyArray<{
  readonly value: RangeParam;
  readonly label: string;
}> = [
  { value: "todo", label: "Todo el histórico" },
  { value: "mes-actual", label: "Mes actual" },
  { value: "mes-anterior", label: "Mes anterior" },
  { value: "90d", label: "90 días" },
];

// ═══════════════════════════════════════════════════════════════════════════
// Row shapes — cast al borde (invoices sí está en el Database generado, pero
// mantenemos el estilo por consistencia con el resto del módulo)
// ═══════════════════════════════════════════════════════════════════════════

interface InvoiceDbRow extends FinanceInvoiceRow {
  readonly id: string;
  readonly invoice_number: string | null;
  readonly description: string;
  readonly issue_date: string;
  readonly due_date: string | null;
}

interface ProjectRow {
  readonly id: string;
  readonly name: string;
  readonly ownership: "propia" | "externa";
}

interface LaunchNameRow {
  readonly id: string;
  readonly name: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Page
// ═══════════════════════════════════════════════════════════════════════════

export default async function FacturasPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const statusParam = parseStatus(sp.status);
  const rangeParam = parseRange(sp.range);
  const page = parsePage(sp.page);

  // Período OPT-IN: 'todo' = sin filtro. Los otros valores mapean a los
  // presets estándar del dashboard (compartidos con `resolvePeriod`).
  const period: Period | null =
    rangeParam === "todo" ? null : resolvePeriod({ range: rangeParam });

  const supabase = await createClient();

  // Fetch: traemos toda la ventana (o todo si range='todo') y filtramos +
  // paginamos en TS. Con 50/pag y bajos volúmenes esto es más simple que
  // armar la paginación server-side y perder el count exacto post-clasificación.
  // Cuando `invoices` crezca a >5k filas, migrar a `.range()` + `count: exact`.
  let query = supabase
    .from("invoices")
    .select(
      "id, project_id, launch_id, invoice_number, description, amount_gross, tax_amount, status, issue_date, due_date, paid_at",
    )
    .order("issue_date", { ascending: false });

  if (statusParam !== "todos") {
    query = query.eq("status", statusParam);
  }
  if (period) {
    query = query.gte("issue_date", period.fromYmd).lte("issue_date", period.toYmd);
  }

  const invoicesRes = await query;
  const invoices = (invoicesRes.data ?? []) as unknown as InvoiceDbRow[];

  // Resolución de FK — proyectos y lanzamientos. Un solo fetch por conjunto.
  const projectIds = Array.from(
    new Set(
      invoices.map((i) => i.project_id).filter((id): id is string => id != null),
    ),
  );
  const launchIds = Array.from(
    new Set(
      invoices.map((i) => i.launch_id).filter((id): id is string => id != null),
    ),
  );

  const [projectsRes, launchesRes] = await Promise.all([
    projectIds.length > 0
      ? supabase.from("projects").select("id, name, ownership").in("id", projectIds)
      : Promise.resolve({ data: [] as ProjectRow[] }),
    launchIds.length > 0
      ? supabase.from("launches").select("id, name").in("id", launchIds)
      : Promise.resolve({ data: [] as LaunchNameRow[] }),
  ]);

  const projectById = new Map<string, ProjectRow>(
    ((projectsRes.data ?? []) as ProjectRow[]).map((p) => [p.id, p]),
  );
  const launchNameById = new Map<string, string>(
    ((launchesRes.data ?? []) as LaunchNameRow[]).map((l) => [
      l.id,
      l.name ?? `Lanzamiento ${l.id.slice(0, 6)}`,
    ]),
  );

  const resolveOwnership = (projectId: string | null): Ownership =>
    projectId ? projectById.get(projectId)?.ownership ?? null : null;

  // Paginación en TS
  const totalCount = invoices.length;
  const start = (page - 1) * PAGE_SIZE;
  const paged = invoices.slice(start, start + PAGE_SIZE);

  // ─── Stats del ContextBar (sobre el conjunto filtrado por status+período) ─
  const cobradasCount = invoices.filter((i) => i.status === "cobrada").length;
  const pendingNet = invoices
    .filter((i) => i.status !== "cobrada" && i.status !== "anulada")
    .reduce((acc, i) => acc + (i.amount_gross - i.tax_amount), 0);

  // ─── Filas de la tabla ─────────────────────────────────────────────────
  interface Row {
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
  }

  const rows: Row[] = paged.map((i) => {
    const project = i.project_id ? projectById.get(i.project_id) ?? null : null;
    return {
      id: i.id,
      issueDate: i.issue_date,
      invoiceNumber: i.invoice_number ?? "—",
      projectLabel: project?.name ?? "Sin proyecto",
      launchLabel: i.launch_id
        ? launchNameById.get(i.launch_id) ?? "—"
        : "—",
      description: i.description,
      amountGross: Number(i.amount_gross),
      taxAmount: Number(i.tax_amount),
      amountNet: Number(i.amount_gross) - Number(i.tax_amount),
      status: i.status as InvoiceStatus,
      classification: classifyInvoice(i, resolveOwnership(i.project_id)),
      paidAt: i.paid_at,
    };
  });

  const columns: Column<Row>[] = [
    {
      key: "issueDate",
      label: "Emisión",
      render: (r) => fmtDate(r.issueDate),
    },
    {
      key: "invoiceNumber",
      label: "Nº",
      render: (r) => r.invoiceNumber,
    },
    {
      key: "project",
      label: "Proyecto",
      render: (r) => r.projectLabel,
    },
    {
      key: "launch",
      label: "Lanzamiento",
      render: (r) => r.launchLabel,
    },
    {
      key: "description",
      label: "Descripción",
      render: (r) => (
        <span
          style={{
            display: "inline-block",
            maxWidth: 320,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            verticalAlign: "middle",
          }}
          title={r.description}
        >
          {r.description}
        </span>
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
      label: "Clasificación",
      render: (r) => (
        <StatusPill kind="invoice-classification" value={r.classification} />
      ),
    },
  ];

  // ─── Helpers de URL ────────────────────────────────────────────────────
  function buildHref(overrides: {
    status?: StatusParam;
    range?: RangeParam;
    page?: number;
  }): string {
    const nextStatus = overrides.status ?? statusParam;
    const nextRange = overrides.range ?? rangeParam;
    const nextPage = overrides.page ?? page;
    const params = new URLSearchParams();
    if (nextStatus !== "todos") params.set("status", nextStatus);
    if (nextRange !== "todo") params.set("range", nextRange);
    if (nextPage > 1) params.set("page", String(nextPage));
    const qs = params.toString();
    return qs ? `/financiero/facturas?${qs}` : "/financiero/facturas";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconFin size={16} />}
        title="Facturas"
        stats={[
          { l: "Total en la vista", v: fCount(totalCount) },
          { l: "Cobradas", v: fCount(cobradasCount) },
          { l: "Pendiente de cobro (neto)", v: fMoney(pendingNet) },
        ]}
      />

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <KgParamPills
          ariaLabel="Filtrar por estado"
          options={STATUS_OPTIONS.map((o) => ({
            label: o.label,
            href: buildHref({ status: o.value, page: 1 }),
            active: statusParam === o.value,
          }))}
        />
        <KgParamPills
          ariaLabel="Filtrar por período"
          options={RANGE_OPTIONS.map((o) => ({
            label: o.label,
            href: buildHref({ range: o.value, page: 1 }),
            active: rangeParam === o.value,
          }))}
        />
      </div>

      <Panel title="Facturas emitidas" pad={false}>
        <KgDataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          totalCount={totalCount}
          emptyTitle="No hay facturas cargadas todavía"
          emptyHint="Las facturas alimentan el ingreso de Kingrow (las clasificadas 'kingrow-income'), el volumen del grupo, las cuentas por cobrar y el conteo de facturas pendientes."
        />
        <KgPaginator
          page={page}
          pageSize={PAGE_SIZE}
          totalCount={totalCount}
          hrefFor={(n) => buildHref({ page: n })}
        />
      </Panel>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers de parseo + presentación
// ═══════════════════════════════════════════════════════════════════════════

function parseStatus(v: string | string[] | undefined): StatusParam {
  if (typeof v !== "string") return "todos";
  const allowed: StatusParam[] = [
    "todos",
    "emitida",
    "cobrada",
    "vencida",
    "anulada",
  ];
  return (allowed as string[]).includes(v) ? (v as StatusParam) : "todos";
}

function parseRange(v: string | string[] | undefined): RangeParam {
  if (typeof v !== "string") return "todo";
  const allowed: RangeParam[] = ["todo", "mes-actual", "mes-anterior", "90d"];
  return (allowed as string[]).includes(v) ? (v as RangeParam) : "todo";
}

function parsePage(v: string | string[] | undefined): number {
  if (typeof v !== "string") return 1;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
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

// ═══════════════════════════════════════════════════════════════════════════
// Pills — mismo look que en /liquidaciones (color en la pill, no en el número)
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
