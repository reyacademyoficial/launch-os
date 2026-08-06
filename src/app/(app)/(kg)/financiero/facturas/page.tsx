import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconFin } from "@/components/kg/icons";
import { KgPaginator } from "@/components/kg/paginator";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { fCount, fMoney } from "@/lib/finance/format";
import {
  classifyInvoice,
  type Ownership,
} from "@/lib/finance/invoice-classification";
import { resolvePeriod, type Period } from "@/lib/finance/period";
import type { FinanceInvoiceRow } from "@/lib/finance/types";
import { listAllProducts } from "@/lib/products/list";
import { listAccessibleProjects } from "@/lib/projects/list";
import { createClient } from "@/lib/supabase/server";

import {
  FacturasView,
  type FacturaRowData,
  type InvoiceStatus,
} from "./facturas-view";
import type {
  ProductOption,
  ProjectOption,
} from "./invoice-form-drawer";

export const metadata: Metadata = { title: "Facturas · Financiero" };

// ═══════════════════════════════════════════════════════════════════════════
// Configuración del listado
// ═══════════════════════════════════════════════════════════════════════════

const PAGE_SIZE = 50;

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
// Row shapes — cast al borde (mismo criterio que el resto del módulo)
// ═══════════════════════════════════════════════════════════════════════════

interface InvoiceDbRow extends FinanceInvoiceRow {
  readonly id: string;
  readonly invoice_number: string | null;
  readonly description: string;
  readonly issue_date: string;
  readonly due_date: string | null;
  readonly currency: string | null;
  readonly category: string | null;
  readonly purchase_date: string | null;
  readonly payment_date: string | null;
  readonly sale_id: string | null;
  readonly product_id: string | null;
  readonly buyer_name: string | null;
  readonly buyer_email: string | null;
  readonly buyer_document: string | null;
  readonly transaction_number: string | null;
  readonly notes: string | null;
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

  const period: Period | null =
    rangeParam === "todo" ? null : resolvePeriod({ range: rangeParam });

  const supabase = await createClient();

  let query = supabase
    .from("invoices")
    .select(
      "id, project_id, launch_id, invoice_number, description, amount_gross, tax_amount, status, issue_date, due_date, paid_at, currency, category, purchase_date, payment_date, sale_id, product_id, buyer_name, buyer_email, buyer_document, transaction_number, notes",
    )
    .order("issue_date", { ascending: false });

  if (statusParam !== "todos") {
    query = query.eq("status", statusParam);
  }
  if (period) {
    query = query
      .gte("issue_date", period.fromYmd)
      .lte("issue_date", period.toYmd);
  }

  const invoicesRes = await query;
  const invoices = (invoicesRes.data ?? []) as unknown as InvoiceDbRow[];

  // Resolución de FK.
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

  const [projectsRes, launchesRes, allProjects, allProducts] = await Promise.all([
    projectIds.length > 0
      ? supabase
          .from("projects")
          .select("id, name, ownership")
          .in("id", projectIds)
      : Promise.resolve({ data: [] as ProjectRow[] }),
    launchIds.length > 0
      ? supabase.from("launches").select("id, name").in("id", launchIds)
      : Promise.resolve({ data: [] as LaunchNameRow[] }),
    listAccessibleProjects(),
    listAllProducts(),
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

  const totalCount = invoices.length;
  const start = (page - 1) * PAGE_SIZE;
  const paged = invoices.slice(start, start + PAGE_SIZE);

  const cobradasCount = invoices.filter((i) => i.status === "cobrada").length;
  const pendingNet = invoices
    .filter((i) => i.status !== "cobrada" && i.status !== "anulada")
    .reduce((acc, i) => acc + (i.amount_gross - i.tax_amount), 0);

  const rows: FacturaRowData[] = paged.map((i) => {
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
      buyerName: i.buyer_name,
      transactionNumber: i.transaction_number,
      category: i.category,
      currency: i.currency ?? "ARS",
      dueDate: i.due_date,
      purchaseDate: i.purchase_date,
      projectId: i.project_id,
      saleId: i.sale_id,
      productId: i.product_id,
      buyerEmail: i.buyer_email,
      buyerDocument: i.buyer_document,
      notes: i.notes,
    };
  });

  const projectOptions: ProjectOption[] = allProjects.map((p) => ({
    id: p.id,
    name: p.name,
  }));
  const productOptions: ProductOption[] = allProducts.map((p) => ({
    id: p.id,
    name: p.name,
    projectId: p.project_id,
  }));

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
        <FacturasView
          rows={rows}
          totalCount={totalCount}
          projects={projectOptions}
          products={productOptions}
          emptyTitle="No hay facturas cargadas todavía"
          emptyHint='Las facturas alimentan el ingreso de Kingrow (las clasificadas "Ingreso Kingrow"), el volumen del grupo, las cuentas por cobrar y el conteo de facturas pendientes. También se generan una por cuota al crear una venta (paso 4).'
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
// Parseo de searchParams
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
