import type { Metadata } from "next";

import { ProjectSalesView } from "@/components/dashboard/sales/project-sales-view";
import { ContextBar } from "@/components/kg/context-bar";
import { IconLaunch } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { listBanks } from "@/lib/banks/list";
import { listInvoicesForSales } from "@/lib/invoices/list-by-sale";
import {
  listCommissionRules,
  listPaymentModalities,
} from "@/lib/commissions/list";
import { fmtNumber } from "@/lib/format";
import { listLaunchesForProject } from "@/lib/launches/list";
import { listProjectSalesData } from "@/lib/launch-sales/list";
import { buildFxLookup, buildSalesFxContext, loadProjectFxRates } from "@/lib/money";
import { listPaymentMethods } from "@/lib/payment-methods/list";
import { listProductsForProject } from "@/lib/products/list";
import { createClient } from "@/lib/supabase/server";
import {
  requireSessionProfile,
  userCanEditLaunchesIn,
} from "@/lib/supabase/auth";
import { listTeamMembersForProject } from "@/lib/team/list";

import { assignLeadOwner } from "../leads/actions";
import {
  addPayment,
  createSale,
  createSaleWithLead,
  deletePayment,
  deleteSale,
  getFirstPaymentContext,
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
 * A diferencia de `/proyectos/[id]/cobros` NO filtramos por lead.status='cerrado':
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

  // Regla 2026-08-28: operador ve Ventas + Cobros editables (mismo permiso
  // que coordinador para gestión operativa del proyecto). Overview sigue
  // redirigido en `page.tsx` — la restricción original era sobre KPIs
  // agregados de revenue, no sobre listados operativos. Cliente sigue leyendo
  // readonly via canEdit=false que sale de userCanEditLaunchesIn.

  const supabase = await createClient();
  const [
    profile,
    salesData,
    modalities,
    products,
    rules,
    paymentMethods,
    teamMembers,
    launches,
    banks,
    fxMap,
    canEdit,
  ] = await Promise.all([
    requireSessionProfile(),
    listProjectSalesData(projectId),
    listPaymentModalities(projectId),
    listProductsForProject(projectId),
    listCommissionRules(projectId),
    listPaymentMethods(),
    listTeamMembersForProject(projectId),
    listLaunchesForProject(projectId),
    listBanks(),
    loadProjectFxRates(supabase, projectId),
    userCanEditLaunchesIn(projectId),
  ]);

  // Closer ve la ficha del alumno para cargar cobros, pero sin comisión.
  const hideCommission = profile.role === "closer";

  const fxCtx = buildSalesFxContext({
    banks,
    paymentMethods,
    leads: salesData.leads,
    launches: launches as unknown as ReadonlyArray<{
      id: string;
      ars_per_usd?: number | null;
    }>,
    sales: salesData.sales,
    fxMap,
  });
  const fxLookup = buildFxLookup(fxCtx, salesData.sales, salesData.payments);

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
  const getFirstPaymentContextAction = getFirstPaymentContext.bind(
    null,
    projectId,
  );

  // Precompute lookup paymentMethodId → moneda efectiva. Cuando el método
  // tiene banco la moneda sale del banco (fuente de verdad post 0101); si
  // no, del propio método (efectivo, otros). Fallback ARS por seguridad.
  const banksById = new Map(banks.map((b) => [b.id, b]));
  const methodCurrencies: Record<string, "ARS" | "USD"> = {};
  for (const m of paymentMethods) {
    const bank = m.bank_id ? banksById.get(m.bank_id) : null;
    methodCurrencies[m.id] = bank?.currency ?? m.currency ?? "ARS";
  }

  return (
    <div className="flex flex-col gap-5">
      {/*
        Conteos y no importes: las ventas del proyecto conviven en ARS y USD y
        acá el contexto FX sólo se usa fila por fila (fxLookup), no para un
        total agregado. Sumar `amount` suelto mezclaría monedas y daría un
        número falso — el agregado en USD vive en Cobros.
      */}
      <ContextBar
        icon={<IconLaunch size={16} />}
        title="Ventas"
        stats={[
          { l: "Ventas", v: fmtNumber(salesData.sales.length) },
          { l: "Alumnos con venta", v: fmtNumber(salesData.leads.length) },
          { l: "Cobros cargados", v: fmtNumber(salesData.payments.length) },
          { l: "Lanzamientos", v: fmtNumber(launches.length) },
        ]}
      />

      {/*
        El header suelto (un <p> con tokens viejos) pasó a ser el Panel que
        envuelve la vista: el título deja de flotar sobre el fondo y la tabla
        queda dentro de la superficie glass del DS, como en Financiero.

        `pad={false}` porque `ProjectSalesView` trae su propio espaciado y su
        tabla va edge-to-edge; el único padding propio del Panel es el de esta
        nota introductoria.

        Sin `fillHeight`: la vista todavía no scrollea internamente, así que la
        page sigue con el wrapper `flex flex-col gap-5` (no `h-full min-h-0`).
        Clavar la altura al viewport dejaría fuera de alcance lo que sobra.
      */}
      <Panel title="Todas las ventas" pad={false}>
        <p
          className="kg-t6"
          style={{
            margin: 0,
            padding: "14px 20px 0",
            color: "var(--kg-text-3)",
            lineHeight: 1.5,
          }}
        >
          Tocá el nombre del alumno para abrir su ficha y editar la venta o
          cargar cobros. Para vencimientos y foco por lanzamiento, usá{" "}
          <b>Cobros</b>.
        </p>

        <ProjectSalesView
          projectId={projectId}
          sales={salesData.sales}
          payments={salesData.payments}
          installments={salesData.installments}
          invoices={await listInvoicesForSales(
            salesData.sales.map((s) => s.id),
          )}
          leads={salesData.leads}
          launches={launches.map((l) => ({ id: l.id, name: l.name }))}
          modalities={modalities}
          products={products}
          rules={rules}
          paymentMethods={paymentMethods}
          methodCurrencies={methodCurrencies}
          teamMembers={teamForModal}
          canEdit={canEdit}
          createSaleAction={createSaleAction}
          createSaleWithLeadAction={createSaleWithLeadAction}
          addPaymentAction={addPaymentAction}
          getFirstPaymentContextAction={getFirstPaymentContextAction}
          deletePaymentAction={deletePaymentAction}
          deleteSaleAction={deleteSaleAction}
          updateSaleProductAction={updateSaleProductAction}
          recalculateSaleAction={recalculateSaleAction}
          updateSaleAction={updateSaleAction}
          updatePaymentInstallmentAction={updatePaymentInstallmentAction}
          updatePaymentMethodAction={updatePaymentMethodAction}
          assignLeadOwnerAction={assignLeadOwnerAction}
          fxLookup={fxLookup}
          hideCommission={hideCommission}
        />
      </Panel>
    </div>
  );
}
