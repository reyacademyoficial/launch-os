import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ProjectSalesView } from "@/components/dashboard/sales/project-sales-view";
import {
  listCommissionRules,
  listPaymentModalities,
} from "@/lib/commissions/list";
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
  createSaleWithLead,
  deletePayment,
  deleteSale,
  recalculateSaleCommission,
  updatePaymentInstallment,
  updatePaymentMethod,
  updateSale,
  updateSaleProduct,
} from "../leads/sale-actions";

export const metadata: Metadata = { title: "Ventas" };

/**
 * Ventas project-wide (Fase 12). Tabla plana de todas las ventas del proyecto
 * con producto/pactado/cobrado/comisión/método/vendedor y acciones editar+
 * borrar. Sustituye a la vista por-launch cuando querés mirar el negocio en
 * su conjunto (todos los lanzamientos a la vez).
 *
 * A diferencia de `/launches/[id]/cobros` NO filtramos por lead.status='cerrado':
 * si existe una sale, la mostramos, aunque el lead se haya movido a otra
 * columna del kanban. Se prioriza que el operador vea toda la plata registrada
 * sin filtros silenciosos.
 */
export default async function ProjectSalesPage({
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

  const teamForModal = teamMembers.map((m) => ({
    id: m.id,
    name: m.name,
    active: m.active,
    role: m.role,
  }));

  const createSaleAction = createSale.bind(null, projectId);
  const createSaleWithLeadAction = createSaleWithLead.bind(null, projectId);
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

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Ventas</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Todas las ventas del proyecto. Tocá el nombre del alumno para abrir su
          ficha y editar la venta o cargar cobros. Para vencimientos y foco por
          lanzamiento, usá <b>Cobros</b>.
        </p>
      </header>

      <ProjectSalesView
        sales={salesData.sales}
        payments={salesData.payments}
        installments={salesData.installments}
        leads={salesData.leads}
        launches={launches.map((l) => ({ id: l.id, name: l.name }))}
        modalities={modalities}
        products={products}
        rules={rules}
        paymentMethods={paymentMethods}
        teamMembers={teamForModal}
        canEdit={canEdit}
        createSaleAction={createSaleAction}
        createSaleWithLeadAction={createSaleWithLeadAction}
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
