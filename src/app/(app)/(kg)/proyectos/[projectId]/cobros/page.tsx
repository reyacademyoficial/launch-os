import type { Metadata } from "next";

import { RecalculateBulkModal } from "@/components/dashboard/commissions/recalculate-bulk-modal";
import { CobrosView } from "@/components/dashboard/sales/cobros-view";
import { ContextBar } from "@/components/kg/context-bar";
import { ErrorBanner } from "@/components/kg/form-primitives";
import { IconLaunch } from "@/components/kg/icons";
import { listBanks } from "@/lib/banks/list";
import { listInvoicesForSales } from "@/lib/invoices/list-by-sale";
import {
  listCommissionRules,
  listPaymentModalities,
} from "@/lib/commissions/list";
import { fmtNumber, fmtPercent } from "@/lib/format";
import { listLaunchesForProject } from "@/lib/launches/list";
import { listProjectSalesData } from "@/lib/launch-sales/list";
import {
  buildFxLookup,
  buildSalesFxContext,
  fmtUsd,
  loadProjectFxRates,
} from "@/lib/money";
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

import { CobrosKpis } from "./cobros-kpis";

export const metadata: Metadata = { title: "Cobros" };

/**
 * Cobros a nivel proyecto (Fase 12). Reusa CobrosView agregando un filtro
 * por launch en la FilterBar. Es la única vista de cobros del sistema —
 * antes había una duplicada por launch, se retiró para consolidar acá.
 *
 * Semántica: filtramos por lead.status='cerrado'. Es la definición canónica
 * de "cobros" en el sistema (cuadra con el KPI revenue del kanban).
 */
export default async function ProjectCobrosPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  // Regla 2026-08-28: operador ve Ventas + Cobros editables (mismo permiso
  // que coordinador para gestión operativa). Overview del proyecto sigue
  // redirigido — la restricción era sobre KPIs agregados, no cobros
  // individuales. Cliente sigue readonly via canEdit=false.

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

  // Closer accede a cobros para cargar, pero no ve nada de comisión (ni la
  // columna en la ficha, ni el botón de recalcular masivo).
  const hideCommission = profile.role === "closer";

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

  // Facturas emitidas de las ventas cerradas — para auto-atar al cobro (paso 5).
  const invoicesForSales = await listInvoicesForSales(
    Array.from(closedSaleIds),
  );

  // ─── Agregado project-wide en USD ─────────────────────────────────────
  //
  // Los payments/sales conviven en ARS (banco ARS) y USD (banco USD, post
  // backfill). Sumar `numeric` sueltos sumaría dólares y pesos como si
  // fueran la misma unidad. Convertimos cada fila a USD usando el contexto
  // FX compartido. Reglas y precedencia viven en `buildSalesFxContext`.
  const fxCtx = buildSalesFxContext({
    banks,
    paymentMethods,
    leads: salesData.leads,
    launches: launches as unknown as ReadonlyArray<{
      id: string;
      ars_per_usd?: number | null;
    }>,
    sales: closedSales,
    fxMap,
  });
  const fxLookup = buildFxLookup(fxCtx, closedSales, closedPayments);

  const banksById = new Map(banks.map((b) => [b.id, b]));
  const methodCurrencies: Record<string, "ARS" | "USD"> = {};
  for (const m of paymentMethods) {
    const bank = m.bank_id ? banksById.get(m.bank_id) : null;
    methodCurrencies[m.id] = bank?.currency ?? m.currency ?? "ARS";
  }

  // Suma manual: el helper `paymentToUsd` / `saleToUsd` devuelve null si no
  // se puede convertir (falta tasa). Contamos esos casos aparte para avisar
  // al operador.
  let collectedRevenue = 0;
  let pledgedRevenue = 0;
  let missingCount = 0;
  for (const p of closedPayments) {
    const v = fxCtx.paymentToUsd(p);
    if (v === null) missingCount++;
    else collectedRevenue += v;
  }
  for (const s of closedSales) {
    const v = fxCtx.saleToUsd(s);
    if (v === null) missingCount++;
    else pledgedRevenue += v;
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
    <div className="flex flex-col gap-5">
      {/*
        REPARTO BARRA ↔ CARDS (antes se duplicaban)
        Hasta ahora la barra y las StatCards mostraban los MISMOS tres números
        (pactado / cobrado / pendiente). Con las cards migradas a
        HeroKpi/SupportKpi el criterio del dashboard de Financiero se aplica
        acá: el ContextBar COMPLEMENTA a los Hero, no los repite.

        Arriba, en el bento, va la foto que se lee UNA vez al entrar: pactado,
        cobrado y el volumen detrás (ventas cerradas, cobros cargados).
        Acá, en la barra sticky, van las dos lecturas del saldo abierto que el
        operador necesita a la vista MIENTRAS scrollea 64 filas: cuánto falta
        (Pendiente) y qué porcentaje del pactado ya entró (Avance). Ninguna de
        las dos está en una card.

        Sin color en los montos — financiar en cuotas es lo normal acá, un
        saldo abierto no es una alarma.

        El 3er stat NO es fijo: aparece solo cuando hay ventas o cobros en ARS
        sin tasa FX cargada, porque en ese caso los totales están incompletos y
        el humano tiene que saberlo aunque el banner explicativo ya se haya ido
        con el scroll. Sin ese caso no mostramos un "0" permanente, que sería
        ruido.
      */}
      <ContextBar
        icon={<IconLaunch size={16} />}
        title="Cobros"
        stats={[
          {
            l: "Pendiente",
            v: fmtUsd(Math.max(pledgedRevenue - collectedRevenue, 0)),
          },
          { l: "Avance", v: fmtPercent(collectionPct) },
          ...(missingCount > 0
            ? [
                {
                  l: "Sin tasa FX",
                  v: fmtNumber(missingCount),
                  c: "#FFB800",
                },
              ]
            : []),
        ]}
      />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <p
          className="kg-t6"
          style={{
            margin: 0,
            maxWidth: "62ch",
            color: "var(--kg-text-3)",
            lineHeight: 1.5,
          }}
        >
          Todos los cobros del proyecto. Cuadra con el KPI revenue del kanban:
          cuenta ventas cuyo lead está en <b>cerrado</b>. Usá el filtro de
          lanzamiento para acotar.
        </p>
        {canEdit && !hideCommission && (
          <RecalculateBulkModal
            triggerLabel="Recalcular comisiones"
            triggerVariant="secondary"
            title="Recalcular comisiones del proyecto"
            scopeDescription="Todas las ventas del proyecto. Elegí si tocar solo las pendientes o incluir las totalmente cobradas."
            previewAction={previewBulkAction}
            executeAction={executeBulkAction}
          />
        )}
      </div>

      <CobrosKpis
        data={{
          pledgedRevenue,
          collectedRevenue,
          salesCount,
          paymentsCount,
        }}
      />

      {missingCount > 0 && (
        <ErrorBanner
          tone="warning"
          message={`${missingCount} ${
            missingCount === 1 ? "cobro" : "cobros"
          } en ARS sin tasa (ni del launch ni mensual). Los totales de arriba no los incluyen — cargá la tasa faltante en Financiero · Tasas FX y volvé a esta página.`}
        />
      )}

      <CobrosView
        sales={closedSales}
        payments={closedPayments}
        installments={closedInstallments}
        invoices={invoicesForSales}
        leads={closedLeads}
        launches={launches.map((l) => ({ id: l.id, name: l.name }))}
        modalities={modalities}
        products={products}
        rules={rules}
        paymentMethods={paymentMethods}
        teamMembers={teamForModal}
        canEdit={canEdit}
        fxLookup={fxLookup}
        methodCurrencies={methodCurrencies}
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
        hideCommission={hideCommission}
      />
    </div>
  );
}
