import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { RecalculateBulkModal } from "@/components/dashboard/commissions/recalculate-bulk-modal";
import { CobrosView } from "@/components/dashboard/sales/cobros-view";
import {
  listCommissionRules,
  listPaymentModalities,
} from "@/lib/commissions/list";
import { fmtMoney, fmtNumber, fmtPercent } from "@/lib/format";
import { aggregateKanbanSales } from "@/lib/launch-sales/aggregate";
import { listLaunchSalesData } from "@/lib/launch-sales/list";
import { getLaunch } from "@/lib/launches/get";
import { listProductsForProject } from "@/lib/products/list";
import { userCanEditLaunchesIn } from "@/lib/supabase/auth";
import { listTeamMembers } from "@/lib/team/list";

import {
  addPayment,
  createSale,
  deletePayment,
  deleteSale,
  previewRecalculateCommissionsBulk,
  recalculateCommissionsBulk,
  recalculateSaleCommission,
  updateSaleProduct,
} from "../../../leads/sale-actions";

export const metadata: Metadata = { title: "Cobros · Lanzamiento" };

/**
 * Tab Cobros: detalle de ventas cerradas + cobros del launch, con filtros
 * y registro de cobros in-place vía SaleModal.
 *
 * Vista pensada para "qué cobré y qué me deben":
 *   - Resumen arriba con pactado/cobrado/% + counts (SSR, siempre visible).
 *   - Tabla de ventas cerradas con filtros y botón por fila para cargar cobros.
 *   - Tabla de cobros compartiendo el mismo universo filtrado.
 *
 * Ignora ventas registradas en leads que NO están en columna `cerrado` —
 * mismo filtro que aplica `aggregateKanbanSales` para el KPI revenue
 * (decisión 2.a, Phase 9).
 */
export default async function LaunchCobrosPage({
  params,
}: {
  readonly params: Promise<{ projectId: string; launchId: string }>;
}) {
  const { projectId, launchId } = await params;

  const [
    launch,
    salesData,
    modalities,
    products,
    rules,
    teamMembers,
    canEdit,
  ] = await Promise.all([
    getLaunch(launchId),
    listLaunchSalesData(projectId, launchId),
    listPaymentModalities(projectId),
    listProductsForProject(projectId),
    listCommissionRules(projectId),
    listTeamMembers(projectId),
    userCanEditLaunchesIn(projectId),
  ]);

  if (!launch || launch.project_id !== projectId) notFound();

  const leadById = new Map(salesData.leads.map((l) => [l.id, l]));

  // Filtramos a las sales que cuentan para el KPI (lead en cerrado del launch),
  // mismo filtro que el agregado.
  const closedSales = salesData.sales.filter((s) => {
    const lead = leadById.get(s.lead_id);
    return lead && lead.launch_id === launchId && lead.status === "cerrado";
  });

  const closedSaleIds = new Set(closedSales.map((s) => s.id));
  const closedPayments = salesData.payments.filter((p) =>
    closedSaleIds.has(p.sale_id),
  );

  // Leads correspondientes a las ventas cerradas. Los que quedan afuera
  // (perdidos, tibios, etc) no se usan en la vista de cobros.
  const closedSaleLeadIds = new Set(closedSales.map((s) => s.lead_id));
  const closedLeads = salesData.leads.filter((l) =>
    closedSaleLeadIds.has(l.id),
  );

  const agg = aggregateKanbanSales(
    salesData.sales,
    salesData.payments,
    salesData.leads,
    launchId,
  );

  const collectionPct =
    agg.pledgedRevenue > 0
      ? (agg.collectedRevenue / agg.pledgedRevenue) * 100
      : 0;

  const manualEstimated = Number(launch.revenue_estimated_manual) || 0;
  const manualCollected = Number(launch.revenue_collected_manual) || 0;
  const hasManual = manualEstimated > 0 || manualCollected > 0;

  const teamForModal = teamMembers.map((m) => ({
    id: m.id,
    name: m.name,
    active: m.active,
    role: m.role,
  }));

  const createSaleAction = createSale.bind(null, projectId);
  const addPaymentAction = addPayment.bind(null, projectId);
  const deletePaymentAction = deletePayment.bind(null, projectId);
  const deleteSaleAction = deleteSale.bind(null, projectId);
  const updateSaleProductAction = updateSaleProduct.bind(null, projectId);
  const recalculateSaleAction = recalculateSaleCommission.bind(null, projectId);
  const previewBulkAction = previewRecalculateCommissionsBulk.bind(null, projectId);
  const executeBulkAction = recalculateCommissionsBulk.bind(null, projectId);

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-fg">Resumen de cobros</h2>
            <p className="text-xs text-fg-subtle">
              Calculado sobre ventas en columna <b>cerrado</b> del kanban. El
              campo manual del form se suma a estos números en el KPI del
              lanzamiento.
            </p>
          </div>
          {canEdit && (
            <RecalculateBulkModal
              triggerLabel="Recalcular comisiones"
              triggerVariant="secondary"
              triggerClassName="!px-3 !py-1.5 !text-xs"
              title="Recalcular comisiones del lanzamiento"
              scopeDescription={`Ventas atribuidas a este launch (${launch.name}). Elegí si solo tocar las pendientes o incluir las totalmente cobradas.`}
              fixedLaunchId={launchId}
              previewAction={previewBulkAction}
              executeAction={executeBulkAction}
            />
          )}
        </header>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Pactado (kanban)" value={fmtMoney(agg.pledgedRevenue)} />
          <StatCard
            label="Cobrado (kanban)"
            value={fmtMoney(agg.collectedRevenue)}
            hint={agg.pledgedRevenue > 0 ? `${fmtPercent(collectionPct)} del pactado` : undefined}
          />
          <StatCard label="Ventas cerradas" value={fmtNumber(agg.salesCount)} />
          <StatCard label="Cobros cargados" value={fmtNumber(agg.paymentsCount)} />
          <StatCard
            label="Pendiente"
            value={fmtMoney(Math.max(agg.pledgedRevenue - agg.collectedRevenue, 0))}
          />
        </div>
        {hasManual && (
          <p className="text-xs text-fg-muted">
            Además del kanban, este launch tiene cargado a mano:{" "}
            <span className="text-fg">{fmtMoney(manualEstimated)}</span>{" "}
            estimado +{" "}
            <span className="text-fg">{fmtMoney(manualCollected)}</span>{" "}
            cobrado.
          </p>
        )}
      </section>

      <CobrosView
        sales={closedSales}
        payments={closedPayments}
        leads={closedLeads}
        modalities={modalities}
        products={products}
        rules={rules}
        teamMembers={teamForModal}
        canEdit={canEdit}
        createSaleAction={createSaleAction}
        addPaymentAction={addPaymentAction}
        deletePaymentAction={deletePaymentAction}
        deleteSaleAction={deleteSaleAction}
        updateSaleProductAction={updateSaleProductAction}
        recalculateSaleAction={recalculateSaleAction}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <div className="text-xs uppercase tracking-wide text-fg-subtle">{label}</div>
      <div className="mt-2 text-xl font-bold text-fg">{value}</div>
      {hint && <div className="mt-1 text-xs text-fg-muted">{hint}</div>}
    </div>
  );
}
