import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RecalculateBulkModal } from "@/components/dashboard/commissions/recalculate-bulk-modal";
import { CobrosView } from "@/components/dashboard/sales/cobros-view";
import {
  listCommissionRules,
  listPaymentModalities,
} from "@/lib/commissions/list";
import { fmtMoney, fmtNumber, fmtPercent } from "@/lib/format";
import { listLaunchesForProject } from "@/lib/launches/list";
import { listProjectSalesData } from "@/lib/launch-sales/list";
import { listPaymentMethods } from "@/lib/payment-methods/list";
import { listProductsForProject } from "@/lib/products/list";
import {
  requireSessionProfile,
  userCanEditLaunchesIn,
} from "@/lib/supabase/auth";
import { listTeamMembers } from "@/lib/team/list";

import { assignLeadOwner } from "../leads/actions";
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
} from "../leads/sale-actions";

export const metadata: Metadata = { title: "Cobros" };

/**
 * Cobros a nivel proyecto (Fase 12). Reusa CobrosView agregando un filtro
 * por launch en la FilterBar. La vista por launch (`/launches/[id]/cobros`)
 * queda viva para focus por lanzamiento; esta agrega la mirada completa
 * "toda la plata cobrada del proyecto" con vencimientos, cronogramas y
 * re-linkeo de cobros huérfanos.
 *
 * Semántica: igual que la vista por launch, filtramos por lead.status='cerrado'.
 * Es la definición canónica de "cobros" en el sistema (cuadra con el KPI
 * revenue del kanban).
 */
export default async function ProjectCobrosPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const profile = await requireSessionProfile();
  if (profile.role === "cliente") redirect(`/proyectos/${projectId}`);

  const [
    salesData,
    modalities,
    products,
    rules,
    paymentMethods,
    teamMembers,
    launches,
    canEdit,
  ] = await Promise.all([
    listProjectSalesData(projectId),
    listPaymentModalities(projectId),
    listProductsForProject(projectId),
    listCommissionRules(projectId),
    listPaymentMethods(projectId),
    listTeamMembers(projectId),
    listLaunchesForProject(projectId),
    userCanEditLaunchesIn(projectId),
  ]);

  const leadById = new Map(salesData.leads.map((l) => [l.id, l]));

  // Mismo filtro que la vista por launch: solo cuentan ventas cuyo lead
  // está en columna `cerrado`. Se queda alineado con `aggregateKanbanSales`.
  const closedSales = salesData.sales.filter((s) => {
    const lead = leadById.get(s.lead_id);
    return !!lead && lead.status === "cerrado";
  });

  const closedSaleIds = new Set(closedSales.map((s) => s.id));
  const closedPayments = salesData.payments.filter((p) =>
    closedSaleIds.has(p.sale_id),
  );
  const closedInstallments = salesData.installments.filter((i) =>
    closedSaleIds.has(i.sale_id),
  );
  const closedSaleLeadIds = new Set(closedSales.map((s) => s.lead_id));
  const closedLeads = salesData.leads.filter((l) =>
    closedSaleLeadIds.has(l.id),
  );

  // Agregado project-wide manual — `aggregateKanbanSales` es per-launch.
  let pledgedRevenue = 0;
  let collectedRevenue = 0;
  for (const s of closedSales) {
    pledgedRevenue += Number(s.total_amount) || 0;
  }
  for (const p of closedPayments) {
    collectedRevenue += Number(p.amount) || 0;
  }
  const salesCount = closedSales.length;
  const paymentsCount = closedPayments.length;
  const collectionPct =
    pledgedRevenue > 0 ? (collectedRevenue / pledgedRevenue) * 100 : 0;

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
  const updateSaleAction = updateSale.bind(null, projectId);
  const updatePaymentInstallmentAction = updatePaymentInstallment.bind(
    null,
    projectId,
  );
  const updatePaymentMethodAction = updatePaymentMethod.bind(null, projectId);
  const assignLeadOwnerAction = assignLeadOwner.bind(null, projectId);
  const previewBulkAction = previewRecalculateCommissionsBulk.bind(
    null,
    projectId,
  );
  const executeBulkAction = recalculateCommissionsBulk.bind(null, projectId);

  return (
    <section className="space-y-10">
      <section className="space-y-3">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Cobros</h1>
            <p className="mt-1 text-sm text-fg-muted">
              Todos los cobros del proyecto. Cuadra con el KPI revenue del
              kanban: cuenta ventas cuyo lead está en <b>cerrado</b>. Usá el
              filtro de lanzamiento para acotar.
            </p>
          </div>
          {canEdit && (
            <RecalculateBulkModal
              triggerLabel="Recalcular comisiones"
              triggerVariant="secondary"
              triggerClassName="!px-3 !py-1.5 !text-xs"
              title="Recalcular comisiones del proyecto"
              scopeDescription="Todas las ventas del proyecto. Elegí si tocar solo las pendientes o incluir las totalmente cobradas."
              previewAction={previewBulkAction}
              executeAction={executeBulkAction}
            />
          )}
        </header>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Pactado" value={fmtMoney(pledgedRevenue)} />
          <StatCard
            label="Cobrado"
            value={fmtMoney(collectedRevenue)}
            hint={
              pledgedRevenue > 0
                ? `${fmtPercent(collectionPct)} del pactado`
                : undefined
            }
          />
          <StatCard label="Ventas cerradas" value={fmtNumber(salesCount)} />
          <StatCard label="Cobros cargados" value={fmtNumber(paymentsCount)} />
          <StatCard
            label="Pendiente"
            value={fmtMoney(
              Math.max(pledgedRevenue - collectedRevenue, 0),
            )}
          />
        </div>
      </section>

      <CobrosView
        sales={closedSales}
        payments={closedPayments}
        installments={closedInstallments}
        leads={closedLeads}
        launches={launches.map((l) => ({ id: l.id, name: l.name }))}
        modalities={modalities}
        products={products}
        rules={rules}
        paymentMethods={paymentMethods}
        teamMembers={teamForModal}
        canEdit={canEdit}
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
      />
    </section>
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
      <div className="text-xs uppercase tracking-wide text-fg-subtle">
        {label}
      </div>
      <div className="mt-2 text-xl font-bold text-fg">{value}</div>
      {hint && <div className="mt-1 text-xs text-fg-muted">{hint}</div>}
    </div>
  );
}
