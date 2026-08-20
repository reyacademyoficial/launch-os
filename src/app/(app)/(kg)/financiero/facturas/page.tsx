import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconFin } from "@/components/kg/icons";
import { KgPageFilters } from "@/components/kg/page-menu";
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

import { RangePills, type PresetOption } from "../range-pills";

import {
  FacturasView,
  type FacturaRowData,
  type InvoiceStatus,
} from "./facturas-view";
import type {
  ProductOption,
  ProjectOption,
} from "./invoice-form-drawer";
import type { UnconciledMovementForInvoice } from "./link-invoice-movement-drawer";
import { NewInvoiceButton } from "./new-invoice-button";

export const metadata: Metadata = { title: "Facturas · Financiero" };

// ═══════════════════════════════════════════════════════════════════════════
// Configuración del listado
// ═══════════════════════════════════════════════════════════════════════════

const PAGE_SIZE = 50;

type StatusParam = InvoiceStatus | "todos";
type RangeParam = "todo" | "mes-actual" | "mes-anterior" | "90d" | "custom";

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

const RANGE_PRESETS: readonly PresetOption[] = [
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
  const fromParam = parseYmd(sp.from);
  const toParam = parseYmd(sp.to);
  const page = parsePage(sp.page);

  // Prioridad: si vienen from+to, se aplica rango custom aunque range esté
  // presente. Alineado con la lógica de resolvePeriod.
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

  // ─── Movimientos sin conciliar (para el drawer de conciliación) ───────
  //
  // Un movimiento está "sin conciliar" cuando NO está vinculado a ningún
  // gasto, factura, nómina o transferencia. Se resuelve con queries
  // separadas + set difference — postgrest-js no tiene NOT EXISTS elegante.
  //
  // Ventana de 12 meses para no traer historia entera. Consistente con el
  // criterio de `gastos/page.tsx`.
  const twelveMonthsAgo = ymdMonthsAgo(12);

  const invoiceIds = invoices.map((i) => i.id);
  const [
    projectsRes,
    launchesRes,
    allProjects,
    allProducts,
    bridgeRes,
    allMovementsRes,
    expensesBankIdsRes,
    invoicesBankIdsRes,
    payrollBankIdsRes,
    transfersBankIdsRes,
    expenseBridgeAllRes,
    invoiceBridgeAllRes,
  ] = await Promise.all([
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
      invoiceIds.length > 0
        ? supabase
            .from("invoice_bank_movements")
            .select(
              "invoice_id, bank_movement_id, role, bank_movements!inner(amount, kind, occurred_at, description, transaction_number, bank_id)",
            )
            .in("invoice_id", invoiceIds)
        : Promise.resolve({ data: [] }),
      supabase
        .from("bank_movements")
        .select("id, bank_id, kind, amount, occurred_at, description")
        .gte("occurred_at", twelveMonthsAgo)
        .order("occurred_at", { ascending: false }),
      supabase
        .from("expenses")
        .select("bank_movement_id")
        .not("bank_movement_id", "is", null),
      supabase
        .from("invoices")
        .select("bank_movement_id")
        .not("bank_movement_id", "is", null),
      supabase
        .from("payroll")
        .select("bank_movement_id")
        .not("bank_movement_id", "is", null),
      supabase
        .from("client_transfers")
        .select("bank_movement_id")
        .not("bank_movement_id", "is", null),
      supabase.from("expense_bank_movements").select("bank_movement_id"),
      supabase.from("invoice_bank_movements").select("bank_movement_id"),
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

  // ─── Movimientos linkeados por factura + gateway_fee derivado ─────────
  //
  // gateway_fee = amount_gross - Σ(movimientos role='principal' kind='in').
  // Si no hay principal linkeado, gateway_fee es null (indeterminado).
  interface BridgeMovementRow {
    readonly invoice_id: string;
    readonly bank_movement_id: string;
    readonly role: "principal" | "comision" | "otro";
    readonly bank_movements: {
      readonly amount: number;
      readonly kind: "in" | "out";
      readonly occurred_at: string;
      readonly description: string | null;
      readonly transaction_number: string | null;
      readonly bank_id: string;
    } | null;
  }
  const bridgeRows = (bridgeRes.data ?? []) as unknown as BridgeMovementRow[];
  interface LinkedMovement {
    readonly movementId: string;
    readonly role: "principal" | "comision" | "otro";
    readonly amount: number;
    readonly kind: "in" | "out";
    readonly occurredAt: string;
    readonly description: string | null;
    readonly bankName: string;
  }
  const movementsByInvoiceId = new Map<string, LinkedMovement[]>();
  const principalSumByInvoice = new Map<string, number>();
  for (const b of bridgeRows) {
    if (!b.bank_movements) continue;
    // NOTA: los bancos ya se resolvieron parcialmente; para el nombre acá
    // fetchemos la fila una sola vez del set de invoices. Por simplicidad
    // resolvemos vía consulta separada abajo (los bancos son pocos).
    const shaped: LinkedMovement = {
      movementId: b.bank_movement_id,
      role: b.role,
      amount: Number(b.bank_movements.amount),
      kind: b.bank_movements.kind,
      occurredAt: b.bank_movements.occurred_at,
      description: b.bank_movements.description,
      bankName: b.bank_movements.bank_id, // placeholder, resolvemos abajo
    };
    const arr = movementsByInvoiceId.get(b.invoice_id);
    if (arr) arr.push(shaped);
    else movementsByInvoiceId.set(b.invoice_id, [shaped]);
    if (b.role === "principal" && b.bank_movements.kind === "in") {
      principalSumByInvoice.set(
        b.invoice_id,
        (principalSumByInvoice.get(b.invoice_id) ?? 0) +
          Number(b.bank_movements.amount),
      );
    }
  }
  // ─── Unconciled movements: set difference con todas las tablas satélite ─
  interface BankMovementDbRow {
    readonly id: string;
    readonly bank_id: string;
    readonly kind: "in" | "out";
    readonly amount: number;
    readonly occurred_at: string;
    readonly description: string | null;
  }
  const allMovements =
    (allMovementsRes.data ?? []) as unknown as BankMovementDbRow[];
  const linkedBankIds = new Set<string>();
  for (const r of (expensesBankIdsRes.data ?? []) as {
    bank_movement_id: string | null;
  }[]) {
    if (r.bank_movement_id) linkedBankIds.add(r.bank_movement_id);
  }
  for (const r of (invoicesBankIdsRes.data ?? []) as {
    bank_movement_id: string | null;
  }[]) {
    if (r.bank_movement_id) linkedBankIds.add(r.bank_movement_id);
  }
  for (const r of (payrollBankIdsRes.data ?? []) as {
    bank_movement_id: string | null;
  }[]) {
    if (r.bank_movement_id) linkedBankIds.add(r.bank_movement_id);
  }
  for (const r of (transfersBankIdsRes.data ?? []) as {
    bank_movement_id: string | null;
  }[]) {
    if (r.bank_movement_id) linkedBankIds.add(r.bank_movement_id);
  }
  for (const r of (expenseBridgeAllRes.data ?? []) as {
    bank_movement_id: string;
  }[]) {
    linkedBankIds.add(r.bank_movement_id);
  }
  for (const r of (invoiceBridgeAllRes.data ?? []) as {
    bank_movement_id: string;
  }[]) {
    linkedBankIds.add(r.bank_movement_id);
  }
  const unconciled = allMovements.filter((m) => !linkedBankIds.has(m.id));

  // ─── Resolver nombres de bancos + proyectos para el drawer y el bridge ─
  //
  // Los bank_movements no tienen columna `currency` propia — heredan de
  // `banks.currency` (introducida en 0103). Antes hardcodeábamos "ARS" para
  // todos, lo cual generaba matches falsos: una factura USD contra
  // movimientos de un banco USD quedaban con currencyMismatch=true y bajo
  // score. Ahora el drawer ve la moneda real del banco.
  interface BankRow {
    readonly id: string;
    readonly name: string;
    readonly project_id: string;
    readonly currency: "ARS" | "USD";
  }
  const bankIdsForBridge = Array.from(
    new Set(
      bridgeRows
        .map((b) => b.bank_movements?.bank_id)
        .filter((id): id is string => !!id),
    ),
  );
  const bankIdsToResolve = Array.from(
    new Set([
      ...bankIdsForBridge,
      ...unconciled.map((m) => m.bank_id),
    ]),
  );

  const banks: BankRow[] = [];
  if (bankIdsToResolve.length > 0) {
    const bankRes = await supabase
      .from("banks")
      .select("id, name, project_id, currency")
      .in("id", bankIdsToResolve);
    banks.push(...((bankRes.data ?? []) as BankRow[]));
  }
  const bankById = new Map<string, BankRow>(banks.map((b) => [b.id, b]));

  const bankProjectIds = Array.from(
    new Set(banks.map((b) => b.project_id).filter((id): id is string => !!id)),
  );
  const missingProjectIds = bankProjectIds.filter((id) => !projectById.has(id));
  const bankProjectNameById = new Map<string, string>();
  for (const [id, p] of projectById) bankProjectNameById.set(id, p.name);
  if (missingProjectIds.length > 0) {
    const extraProjectsRes = await supabase
      .from("projects")
      .select("id, name")
      .in("id", missingProjectIds);
    for (const p of ((extraProjectsRes.data ?? []) as {
      id: string;
      name: string;
    }[])) {
      bankProjectNameById.set(p.id, p.name);
    }
  }

  // Backfill nombre de banco en los movimientos linkeados por factura.
  for (const [, arr] of movementsByInvoiceId) {
    for (const m of arr) {
      (m as { bankName: string }).bankName =
        bankById.get((m as { bankName: string }).bankName)?.name ?? "—";
    }
  }

  const unconciledForDrawer: UnconciledMovementForInvoice[] = unconciled.map(
    (m) => {
      const bank = bankById.get(m.bank_id);
      return {
        id: m.id,
        amount: Number(m.amount),
        occurredAt: m.occurred_at,
        // Los movimientos no tienen moneda propia — la moneda es la del
        // banco al que pertenecen (banks.currency, 0103). Sin banco visible
        // por RLS caemos a ARS por consistencia con el default histórico.
        currency: bank?.currency ?? "ARS",
        kind: m.kind,
        bankName: bank?.name ?? "—",
        projectName: bank
          ? bankProjectNameById.get(bank.project_id) ?? "—"
          : "—",
        description: m.description ?? "",
      };
    },
  );

  const totalCount = invoices.length;
  const start = (page - 1) * PAGE_SIZE;
  const paged = invoices.slice(start, start + PAGE_SIZE);

  const cobradasCount = invoices.filter((i) => i.status === "cobrada").length;
  const pendingNet = invoices
    .filter((i) => i.status !== "cobrada" && i.status !== "anulada")
    .reduce((acc, i) => acc + (i.amount_gross - i.tax_amount), 0);

  const rows: FacturaRowData[] = paged.map((i) => {
    const project = i.project_id ? projectById.get(i.project_id) ?? null : null;
    const linkedMovements = movementsByInvoiceId.get(i.id) ?? [];
    const principalSum = principalSumByInvoice.get(i.id) ?? 0;
    // gateway_fee sólo tiene sentido cuando hay al menos un movimiento
    // principal linkeado. Sin principal, es null (desconocido).
    const gatewayFee =
      principalSum > 0
        ? Math.max(Number(i.amount_gross) - principalSum, 0)
        : null;
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
      linkedMovements,
      gatewayFee,
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
    page?: number;
  }): string {
    const nextStatus = overrides.status ?? statusParam;
    const nextPage = overrides.page ?? page;
    const params = new URLSearchParams();
    if (nextStatus !== "todos") params.set("status", nextStatus);
    // Preservar rango vigente (preset o custom) al re-filtrar por otro eje.
    if (isCustom && fromParam && toParam) {
      params.set("from", fromParam);
      params.set("to", toParam);
    } else if (rangeParam !== "todo") {
      params.set("range", rangeParam);
    }
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

      <KgPageFilters
        activeCount={
          (statusParam !== "todos" ? 1 : 0) +
          (rangeParam !== "todo" || (period?.fromYmd && period?.toYmd)
            ? 1
            : 0)
        }
      >
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
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
            activePreset={isCustom || rangeParam === "custom" ? null : rangeParam}
            activeFrom={period?.fromYmd ?? null}
            activeTo={period?.toYmd ?? null}
            baseHref="/financiero/facturas"
          />
        </div>
      </KgPageFilters>

      <Panel
        title="Facturas emitidas"
        pad={false}
        actions={
          <NewInvoiceButton
            projects={projectOptions}
            products={productOptions}
          />
        }
      >
        <FacturasView
          rows={rows}
          totalCount={totalCount}
          projects={projectOptions}
          products={productOptions}
          unconciledMovements={unconciledForDrawer}
          emptyTitle="No hay facturas cargadas todavía"
          emptyHint='Las facturas alimentan el ingreso de Kingrow (las clasificadas "Ingreso Kingrow"), el volumen del grupo, las cuentas por cobrar y el conteo de facturas pendientes. También se generan una por cuota al crear una venta (paso 4).'
          footerActions={
            <KgPaginator
              page={page}
              pageSize={PAGE_SIZE}
              totalCount={totalCount}
              hrefFor={(n) => buildHref({ page: n })}
              compact
            />
          }
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

function ymdMonthsAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
