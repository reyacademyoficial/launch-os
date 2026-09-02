import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { RecalculateBulkModal } from "@/components/dashboard/commissions/recalculate-bulk-modal";
import { ExportLeadsButton } from "@/components/dashboard/leads/export-leads-button";
import { ImportLeadsModal } from "@/components/dashboard/leads/import-modal";
import { KanbanBoard } from "@/components/dashboard/leads/kanban-board";
import { LeadFormModal } from "@/components/dashboard/leads/lead-form-modal";
import { LeadsTable } from "@/components/dashboard/leads/leads-table";
import { ContextBar } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import { IconLaunch, IconPanelLeft, IconTable } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { KgViewToggle } from "@/components/kg/view-toggle";
import {
  listCommissionRules,
  listPaymentModalities,
} from "@/lib/commissions/list";
import type { InstallmentRow, PaymentRow, SaleRow } from "@/lib/commissions/types";
import { listBanks } from "@/lib/banks/list";
import { fmtNumber } from "@/lib/format";
import { listLaunchesForProject } from "@/lib/launches/list";
import { buildFxLookup, buildSalesFxContext, loadProjectFxRates } from "@/lib/money";
import { listPaymentMethods } from "@/lib/payment-methods/list";
import { listProductsForProject } from "@/lib/products/list";
import { listKanbanLeads, listLeadsPaginated } from "@/lib/leads/search";
import {
  SORTABLE_COLUMNS,
  SORT_DIRECTIONS,
  type SortableColumn,
  type SortDirection,
} from "@/lib/leads/search-config";
import {
  LEAD_STATUSES,
  type LeadSource,
  type LeadStatus,
} from "@/lib/leads/types";
import {
  listInstallmentsForSales,
} from "@/lib/installments/list";
import { listInvoicesForSales } from "@/lib/invoices/list-by-sale";
import {
  listPaymentsForProject,
  listSalesForProject,
} from "@/lib/sales/list";
import { createClient } from "@/lib/supabase/server";
import {
  denyCloserOutsideVentas,
  requireSessionProfile,
  userCanEditLaunchesIn,
} from "@/lib/supabase/auth";
import { listTeamMembersForProject } from "@/lib/team/list";

import {
  assignLeadOwner,
  createLead,
  deleteLead,
  moveLeadStatus,
  updateLead,
} from "./actions";
import {
  addPayment,
  createSale,
  deletePayment,
  deleteSale,
  previewRecalculateCommissionsBulk,
  recalculateCommissionsBulk,
  recalculateSaleCommission,
  updatePaymentInstallment,
  updatePaymentMethod,
  updateSale,
  updateSaleProduct,
} from "./sale-actions";

export const metadata: Metadata = { title: "Leads" };

type Tab = "tabla" | "kanban";

/**
 * Index de leads con dos vistas:
 *   - "tabla" (default): server-paginated/filtered/sorted, para volumen alto.
 *     Toda la URL state (?status, ?page, ?q, ?sort, ?dir, ?from, ?to,
 *     ?setter, ?launch) se lee acá y se pasa a `listLeadsPaginated`.
 *   - "kanban": filtrada a `pinned_to_kanban = true`, drag-and-drop existente.
 *     Pensada como vista de trabajo del subconjunto promovido a mano.
 *
 * Decisión: NO usamos subrutas /leads/tabla y /leads/kanban porque
 * compartirían el 80% de los fetches (teamMembers, launches, modalities, etc).
 * El tab en la query param permite reusar la carga sin duplicar páginas.
 */
export default async function LeadsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ projectId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;

  const profile = await requireSessionProfile();
  if (profile.role === "cliente") redirect(`/proyectos/${projectId}`);
  denyCloserOutsideVentas(profile, projectId);

  const tab: Tab = readString(sp.view) === "kanban" ? "kanban" : "tabla";

  // ─── Fetches compartidos por ambos tabs ────────────────────────────────
  const supabase = await createClient();
  const [
    teamMembers,
    launches,
    canEdit,
    sales,
    payments,
    modalities,
    products,
    rules,
    paymentMethods,
    banks,
    fxMap,
  ] = await Promise.all([
    listTeamMembersForProject(projectId),
    listLaunchesForProject(projectId),
    userCanEditLaunchesIn(projectId),
    listSalesForProject(projectId),
    listPaymentsForProject(projectId),
    listPaymentModalities(projectId),
    listProductsForProject(projectId),
    listCommissionRules(projectId),
    listPaymentMethods(),
    listBanks(),
    loadProjectFxRates(supabase, projectId),
  ]);

  // Fase 11: cuotas por venta. Se cargan una vez y se agrupan por sale_id
  // para pasárselas al SaleModal (evita N+1 en el kanban).
  const saleIds = sales.map((s) => s.id);
  const [installments, invoicesForSales] = await Promise.all([
    listInstallmentsForSales(saleIds),
    listInvoicesForSales(saleIds),
  ]);

  const teamForForm = teamMembers.map((m) => ({
    id: m.id,
    name: m.name,
    active: m.active,
    role: m.role,
  }));
  const launchesForForm = launches.map((l) => ({ id: l.id, name: l.name }));
  // Subset de evergreens para el filtro "Reciclado de" de la tabla.
  const evergreenLaunchesForFilter = launches
    .filter((l) => l.is_evergreen === true)
    .map((l) => ({ id: l.id, name: l.name }));

  // Fase 8: un lead puede tener N ventas. Agrupamos por lead_id como array.
  const salesByLeadId = new Map<string, SaleRow[]>();
  for (const s of sales) {
    const arr = salesByLeadId.get(s.lead_id);
    if (arr) arr.push(s);
    else salesByLeadId.set(s.lead_id, [s]);
  }
  const paymentsBySaleId = new Map<string, PaymentRow[]>();
  for (const p of payments) {
    const existing = paymentsBySaleId.get(p.sale_id);
    if (existing) existing.push(p);
    else paymentsBySaleId.set(p.sale_id, [p]);
  }
  const installmentsBySaleId = new Map<string, InstallmentRow[]>();
  for (const i of installments) {
    const existing = installmentsBySaleId.get(i.sale_id);
    if (existing) existing.push(i);
    else installmentsBySaleId.set(i.sale_id, [i]);
  }
  const invoicesBySaleId = new Map<
    string,
    Array<{
      readonly id: string;
      readonly invoice_number: string | null;
      readonly installment_id: string | null;
      readonly amount_gross: number;
      readonly status: string;
    }>
  >();
  for (const inv of invoicesForSales) {
    if (inv.sale_id == null) continue;
    const existing = invoicesBySaleId.get(inv.sale_id);
    const shaped = {
      id: inv.id,
      invoice_number: inv.invoice_number,
      installment_id: inv.installment_id,
      amount_gross: Number(inv.amount_gross),
      status: inv.status,
    };
    if (existing) existing.push(shaped);
    else invoicesBySaleId.set(inv.sale_id, [shaped]);
  }

  const createAction = createLead.bind(null, projectId);
  const moveAction = moveLeadStatus.bind(null, projectId);
  const updateAction = updateLead.bind(null, projectId);
  const deleteAction = deleteLead.bind(null, projectId);
  const createSaleAction = createSale.bind(null, projectId);
  const addPaymentAction = addPayment.bind(null, projectId);
  const deletePaymentAction = deletePayment.bind(null, projectId);
  const deleteSaleAction = deleteSale.bind(null, projectId);
  const updateSaleProductAction = updateSaleProduct.bind(null, projectId);
  const recalculateSaleAction = recalculateSaleCommission.bind(null, projectId);
  const updateSaleAction = updateSale.bind(null, projectId);
  const updatePaymentInstallmentAction = updatePaymentInstallment.bind(
    null,
    projectId,
  );
  const updatePaymentMethodAction = updatePaymentMethod.bind(null, projectId);
  const assignLeadOwnerAction = assignLeadOwner.bind(null, projectId);
  const previewBulkAction = previewRecalculateCommissionsBulk.bind(null, projectId);
  const executeBulkAction = recalculateCommissionsBulk.bind(null, projectId);

  const activeMembers = teamMembers.filter((m) => m.active).length;

  return (
    /*
      El wrapper cambia según la vista y NO por gusto: la tabla monta
      `Panel fillHeight` + `KgDataTable fillHeight`, y ese pattern exige que
      TODOS los ancestros propaguen altura (`h-full min-h-0`). El kanban, en
      cambio, crece a lo alto/ancho por su cuenta — clavarle la altura al
      viewport dejaría fuera de alcance lo que sobrepase, porque deja de
      sumar al `scrollHeight` del <main>.
    */
    <div
      className={
        tab === "tabla"
          ? "flex h-full min-h-0 flex-col gap-5"
          : "flex flex-col gap-5"
      }
    >
      {/*
        El total de leads NO entra acá: cada vista lo trae por su cuenta (la
        tabla paginada dentro de `TablaTab`, el kanban filtrado a promovidos),
        así que en el scope de la página no hay un número que valga para las
        dos. Los stats son los agregados de venta del proyecto, que sí son los
        mismos mires la vista que mires.
      */}
      <ContextBar
        icon={<IconLaunch size={16} />}
        title="Leads"
        stats={[
          { l: "Leads con venta", v: fmtNumber(salesByLeadId.size) },
          { l: "Ventas", v: fmtNumber(sales.length) },
          { l: "Cobros cargados", v: fmtNumber(payments.length) },
          { l: "Lanzamientos", v: fmtNumber(launches.length) },
        ]}
      />

      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {/*
            El toggle reemplaza a los tabs con borde inferior: mismo contrato
            de URL (`?view=kanban`, tabla es el default sin param), una fila
            menos de alto y sin tokens deprecados.
          */}
          <KgViewToggle
            active={tab}
            ariaLabel="Vista de leads"
            options={[
              {
                value: "tabla",
                label: "Vista tabla",
                icon: <IconTable size={16} />,
                href: `/proyectos/${projectId}/leads`,
              },
              {
                value: "kanban",
                label: "Kanban (promovidos)",
                icon: <IconPanelLeft size={16} />,
                href: `/proyectos/${projectId}/leads?view=kanban`,
              },
            ]}
          />
          <Link
            href={`/proyectos/${projectId}/equipo`}
            className="kg-t7 kg-focus"
            style={{
              color: "var(--kg-text-3)",
              textDecoration: "underline",
              textUnderlineOffset: 2,
            }}
          >
            {activeMembers} team members activos
          </Link>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <ExportLeadsButton projectId={projectId} />
            <ImportLeadsModal
              projectId={projectId}
              launches={launchesForForm}
              triggerLabel="⇪ Importar xlsx"
            />
            <RecalculateBulkModal
              triggerLabel="↻ Recalcular ventas"
              triggerVariant="secondary"
              triggerClassName="!px-3 !py-1.5 !text-xs"
              title="Recalcular comisiones del proyecto"
              scopeDescription="Todas las ventas del proyecto, en cualquier lanzamiento y producto. Elegí si tocar solo las pendientes o incluir las totalmente cobradas."
              previewAction={previewBulkAction}
              executeAction={executeBulkAction}
            />
            <LeadFormModal
              triggerLabel="+ Nuevo lead"
              title="Nuevo lead"
              submitLabel="Crear"
              action={createAction}
              teamMembers={teamForForm}
              launches={launchesForForm}
            />
          </div>
        )}
      </header>

      {tab === "kanban" ? (
        <KanbanTab
          projectId={projectId}
          teamForForm={teamForForm}
          launchesForForm={launchesForForm}
          canEdit={canEdit}
          moveAction={moveAction}
          updateAction={updateAction}
          deleteAction={deleteAction}
          salesByLeadId={salesByLeadId}
          paymentsBySaleId={paymentsBySaleId}
          installmentsBySaleId={installmentsBySaleId}
          invoicesBySaleId={invoicesBySaleId}
          modalities={modalities}
          products={products}
          rules={rules}
          paymentMethods={paymentMethods}
          createSaleAction={createSaleAction}
          addPaymentAction={addPaymentAction}
          deletePaymentAction={deletePaymentAction}
          deleteSaleAction={deleteSaleAction}
          updateSaleProductAction={updateSaleProductAction}
          recalculateSaleAction={recalculateSaleAction}
          updateSaleAction={updateSaleAction}
          updatePaymentInstallmentAction={updatePaymentInstallmentAction}
          updatePaymentMethodAction={updatePaymentMethodAction}
          assignLeadOwnerAction={assignLeadOwnerAction}
          banks={banks}
          fullLaunches={launches as unknown as ReadonlyArray<{ id: string; ars_per_usd?: number | null }>}
          projectSales={sales}
          projectPayments={payments}
          fxMap={fxMap}
        />
      ) : (
        <TablaTab
          projectId={projectId}
          searchParams={sp}
          teamForForm={teamForForm}
          launchesForForm={launchesForForm}
          evergreenLaunches={evergreenLaunchesForFilter}
        />
      )}
    </div>
  );
}

async function TablaTab({
  projectId,
  searchParams,
  teamForForm,
  launchesForForm,
  evergreenLaunches,
}: {
  readonly projectId: string;
  readonly searchParams: Record<string, string | string[] | undefined>;
  readonly teamForForm: ReadonlyArray<{
    id: string;
    name: string;
    active: boolean;
    role: import("@/lib/team/types").TeamMemberRole;
  }>;
  readonly launchesForForm: ReadonlyArray<{ id: string; name: string }>;
  readonly evergreenLaunches: ReadonlyArray<{ id: string; name: string }>;
}) {
  const page = parsePositiveInt(readString(searchParams.page)) ?? 1;
  const search = readString(searchParams.q) ?? "";
  const status = filterLiteral(
    readString(searchParams.status),
    LEAD_STATUSES as ReadonlyArray<string>,
  ) as LeadStatus | undefined;
  const source = filterLiteral(
    readString(searchParams.source),
    ["manual", "import", "meta", "ghl", "otro"],
  ) as LeadSource | undefined;
  const teamMemberId = readString(searchParams.setter);
  const launchId = readString(searchParams.launch);
  const dateFrom = readString(searchParams.from);
  const dateTo = readString(searchParams.to);
  // `recycled` admite: uuid de evergreen, "any" (cualquier reciclado), "none"
  // (no reciclado), o vacío. Cualquier otro string se ignora (vuelve a
  // "todos") — defensa contra URL tampering.
  const recycledRaw = readString(searchParams.recycled);
  const recycledFrom =
    recycledRaw === "any" || recycledRaw === "none"
      ? recycledRaw
      : recycledRaw && /^[0-9a-f-]{36}$/i.test(recycledRaw)
        ? recycledRaw
        : undefined;
  const sortColumn = (filterLiteral(
    readString(searchParams.sort),
    SORTABLE_COLUMNS as ReadonlyArray<string>,
  ) ?? "created_at") as SortableColumn;
  const sortDirection = (filterLiteral(
    readString(searchParams.dir),
    SORT_DIRECTIONS as ReadonlyArray<string>,
  ) ?? "desc") as SortDirection;

  const result = await listLeadsPaginated({
    projectId,
    page,
    pageSize: 50,
    search,
    sortColumn,
    sortDirection,
    filters: {
      status,
      source,
      teamMemberId: teamMemberId || undefined,
      launchId: launchId || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      recycledFrom,
    },
  });

  return (
    /*
      `pad={false}` porque la tabla trae su propio padding de celda, y
      `fillHeight` para que el <tbody> scrollee dentro del panel en vez de
      empujar la página: con 50 filas por página el header y el paginador
      quedan siempre a la vista.
    */
    <Panel
      title="Leads"
      pad={false}
      fillHeight
      actions={
        <span className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
          {fmtNumber(result.totalCount)} en la vista
        </span>
      }
    >
      <LeadsTable
        projectId={projectId}
        rows={result.rows}
        totalCount={result.totalCount}
        page={result.page}
        pageSize={result.pageSize}
        totalPages={result.totalPages}
        initialSearch={search}
        initialFilters={{
          status: status ?? "",
          source: source ?? "",
          teamMemberId: teamMemberId ?? "",
          launchId: launchId ?? "",
          dateFrom: dateFrom ?? "",
          dateTo: dateTo ?? "",
          recycledFrom: recycledFrom ?? "",
        }}
        initialSort={{ column: sortColumn, direction: sortDirection }}
        teamMembers={teamForForm}
        launches={launchesForForm}
        evergreenLaunches={evergreenLaunches}
      />
    </Panel>
  );
}

async function KanbanTab({
  projectId,
  teamForForm,
  launchesForForm,
  canEdit,
  moveAction,
  updateAction,
  deleteAction,
  salesByLeadId,
  paymentsBySaleId,
  installmentsBySaleId,
  invoicesBySaleId,
  modalities,
  products,
  rules,
  paymentMethods,
  createSaleAction,
  addPaymentAction,
  deletePaymentAction,
  deleteSaleAction,
  updateSaleProductAction,
  recalculateSaleAction,
  updateSaleAction,
  updatePaymentInstallmentAction,
  updatePaymentMethodAction,
  assignLeadOwnerAction,
  banks,
  fullLaunches,
  projectSales,
  projectPayments,
  fxMap,
}: {
  readonly projectId: string;
  readonly teamForForm: ReadonlyArray<{
    id: string;
    name: string;
    active: boolean;
    role: import("@/lib/team/types").TeamMemberRole;
  }>;
  readonly launchesForForm: ReadonlyArray<{ id: string; name: string }>;
  readonly canEdit: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly moveAction: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly updateAction: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly deleteAction: any;
  readonly salesByLeadId: ReadonlyMap<string, ReadonlyArray<SaleRow>>;
  readonly paymentsBySaleId: ReadonlyMap<string, ReadonlyArray<PaymentRow>>;
  readonly installmentsBySaleId: ReadonlyMap<string, ReadonlyArray<InstallmentRow>>;
  readonly invoicesBySaleId: ReadonlyMap<
    string,
    ReadonlyArray<{
      readonly id: string;
      readonly invoice_number: string | null;
      readonly installment_id: string | null;
      readonly amount_gross: number;
      readonly status: string;
    }>
  >;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly modalities: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly products: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly rules: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly paymentMethods: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly createSaleAction: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly addPaymentAction: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly deletePaymentAction: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly deleteSaleAction: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly updateSaleProductAction: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly recalculateSaleAction: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly updateSaleAction: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly updatePaymentInstallmentAction: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly updatePaymentMethodAction: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly assignLeadOwnerAction: any;
  readonly banks: ReadonlyArray<{ id: string; currency: "ARS" | "USD" }>;
  readonly fullLaunches: ReadonlyArray<{ id: string; ars_per_usd?: number | null }>;
  readonly projectSales: ReadonlyArray<SaleRow>;
  readonly projectPayments: ReadonlyArray<PaymentRow>;
  readonly fxMap: Map<string, number>;
}) {
  const leads = await listKanbanLeads(projectId);

  const fxCtx = buildSalesFxContext({
    banks,
    paymentMethods,
    leads,
    launches: fullLaunches,
    sales: projectSales,
    fxMap,
  });
  const fxLookup = buildFxLookup(fxCtx, projectSales, projectPayments);

  if (leads.length === 0) {
    return (
      <Panel pad={false}>
        <EmptyState
          icon={<IconLaunch size={18} />}
          title="El kanban no tiene leads promovidos todavía"
          hint="En la tabla, seleccioná los leads que vas a trabajar a mano y promovelos con “★ Al kanban”."
          actions={
            <Link
              href={`/proyectos/${projectId}/leads`}
              className="kg-focus"
              style={{
                padding: "6px 14px",
                borderRadius: 999,
                background: "transparent",
                border: "1px solid var(--kg-border-subtle)",
                color: "var(--kg-text-2)",
                fontSize: 12,
                fontWeight: 700,
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              Ir a la tabla
            </Link>
          }
        />
      </Panel>
    );
  }

  return (
    <KanbanBoard
      leads={leads}
      teamMembers={teamForForm}
      launches={launchesForForm}
      canEdit={canEdit}
      moveAction={moveAction}
      updateAction={updateAction}
      deleteAction={deleteAction}
      salesByLeadId={salesByLeadId}
      paymentsBySaleId={paymentsBySaleId}
      installmentsBySaleId={installmentsBySaleId}
      invoicesBySaleId={invoicesBySaleId}
      modalities={modalities}
      products={products}
      rules={rules}
      paymentMethods={paymentMethods}
      createSaleAction={createSaleAction}
      addPaymentAction={addPaymentAction}
      deletePaymentAction={deletePaymentAction}
      deleteSaleAction={deleteSaleAction}
      updateSaleProductAction={updateSaleProductAction}
      recalculateSaleAction={recalculateSaleAction}
      updateSaleAction={updateSaleAction}
      updatePaymentInstallmentAction={updatePaymentInstallmentAction}
      updatePaymentMethodAction={updatePaymentMethodAction}
      assignLeadOwnerAction={assignLeadOwnerAction}
      fxLookup={fxLookup}
    />
  );
}

// ─── helpers de parseo de query params ──────────────────────────────────────

function readString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function parsePositiveInt(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function filterLiteral(
  v: string | undefined,
  allowed: ReadonlyArray<string>,
): string | undefined {
  if (!v) return undefined;
  return allowed.includes(v) ? v : undefined;
}
