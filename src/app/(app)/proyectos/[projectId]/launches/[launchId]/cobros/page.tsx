import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { listPaymentModalities } from "@/lib/commissions/list";
import { fmtDate, fmtMoney, fmtNumber, fmtPercent } from "@/lib/format";
import { aggregateKanbanSales } from "@/lib/launch-sales/aggregate";
import { listLaunchSalesData } from "@/lib/launch-sales/list";
import { getLaunch } from "@/lib/launches/get";

export const metadata: Metadata = { title: "Cobros · Lanzamiento" };

/**
 * Tab Cobros: detalle de ventas cerradas + cobros del launch.
 *
 * Vista pensada para "qué cobré y qué me deben":
 *   - Resumen arriba con pactado/cobrado/% + counts.
 *   - Tabla de ventas (una fila por sale en columna cerrado).
 *   - Tabla de cobros (una fila por payment, con acumulado por venta).
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

  const [launch, salesData, modalities] = await Promise.all([
    getLaunch(launchId),
    listLaunchSalesData(projectId, launchId),
    listPaymentModalities(projectId),
  ]);

  if (!launch || launch.project_id !== projectId) notFound();

  const leadById = new Map(salesData.leads.map((l) => [l.id, l]));
  const modalityById = new Map(modalities.map((m) => [m.id, m]));

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

  const agg = aggregateKanbanSales(
    salesData.sales,
    salesData.payments,
    salesData.leads,
    launchId,
  );

  const collectedByPSale = new Map<string, number>();
  for (const p of closedPayments) {
    collectedByPSale.set(
      p.sale_id,
      (collectedByPSale.get(p.sale_id) ?? 0) + Number(p.amount),
    );
  }

  // Cobros ordenados por fecha asc para mostrar acumulado por venta.
  const paymentsSorted = [...closedPayments].sort((a, b) =>
    a.paid_at.localeCompare(b.paid_at),
  );
  const accumByPaymentId = new Map<string, number>();
  const runningBySale = new Map<string, number>();
  for (const p of paymentsSorted) {
    const next = (runningBySale.get(p.sale_id) ?? 0) + Number(p.amount);
    runningBySale.set(p.sale_id, next);
    accumByPaymentId.set(p.id, next);
  }
  // Mostramos cobros más recientes primero en la tabla.
  const paymentsForTable = [...paymentsSorted].reverse();

  const collectionPct =
    agg.pledgedRevenue > 0
      ? (agg.collectedRevenue / agg.pledgedRevenue) * 100
      : 0;

  const manualEstimated = Number(launch.revenue_estimated_manual) || 0;
  const manualCollected = Number(launch.revenue_collected_manual) || 0;
  const hasManual = manualEstimated > 0 || manualCollected > 0;

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <header>
          <h2 className="text-base font-semibold text-fg">Resumen de cobros</h2>
          <p className="text-xs text-fg-subtle">
            Calculado sobre ventas en columna <b>cerrado</b> del kanban. El
            campo manual del form se suma a estos números en el KPI del
            lanzamiento.
          </p>
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

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-fg">Ventas cerradas</h2>
        {closedSales.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-surface/40 p-8 text-center text-sm text-fg-muted">
            Sin ventas en columna <b>cerrado</b> para este lanzamiento.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-surface text-left text-xs uppercase tracking-wide text-fg-subtle">
                <tr>
                  <th className="px-3 py-3 font-medium">Lead</th>
                  <th className="px-3 py-3 font-medium">Modalidad</th>
                  <th className="px-3 py-3 text-right font-medium">Pactado</th>
                  <th className="px-3 py-3 text-right font-medium">Cobrado</th>
                  <th className="px-3 py-3 text-right font-medium">% cobrado</th>
                  <th className="px-3 py-3 font-medium">Cerrado el</th>
                </tr>
              </thead>
              <tbody>
                {closedSales.map((s) => {
                  const lead = leadById.get(s.lead_id);
                  const modality = modalityById.get(s.payment_modality_id);
                  const collected = collectedByPSale.get(s.id) ?? 0;
                  const pct =
                    s.total_amount > 0
                      ? (collected / s.total_amount) * 100
                      : 0;
                  return (
                    <tr
                      key={s.id}
                      className="border-t border-border hover:bg-surface"
                    >
                      <td className="px-3 py-3 font-medium text-fg">
                        {lead?.name ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-fg-muted">
                        {modality?.name ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-fg">
                        {fmtMoney(s.total_amount)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-fg">
                        {fmtMoney(collected)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-fg-muted">
                        {fmtPercent(pct)}
                      </td>
                      <td className="px-3 py-3 text-fg-muted">
                        {fmtDate(s.closed_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-fg">Historial de cobros</h2>
        {paymentsForTable.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-surface/40 p-8 text-center text-sm text-fg-muted">
            Sin cobros registrados todavía. Los cobros se cargan desde el botón
            💰 de cada venta en el kanban de Leads.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-surface text-left text-xs uppercase tracking-wide text-fg-subtle">
                <tr>
                  <th className="px-3 py-3 font-medium">Fecha</th>
                  <th className="px-3 py-3 font-medium">Lead</th>
                  <th className="px-3 py-3 font-medium">Modalidad</th>
                  <th className="px-3 py-3 text-right font-medium">Monto</th>
                  <th className="px-3 py-3 text-right font-medium">
                    Acumulado venta
                  </th>
                  <th className="px-3 py-3 font-medium">Notas</th>
                </tr>
              </thead>
              <tbody>
                {paymentsForTable.map((p) => {
                  const sale = closedSales.find((s) => s.id === p.sale_id);
                  const lead = sale ? leadById.get(sale.lead_id) : null;
                  const modality = sale
                    ? modalityById.get(sale.payment_modality_id)
                    : null;
                  return (
                    <tr
                      key={p.id}
                      className="border-t border-border hover:bg-surface"
                    >
                      <td className="px-3 py-3 text-fg-muted">
                        {fmtDate(p.paid_at)}
                      </td>
                      <td className="px-3 py-3 font-medium text-fg">
                        {lead?.name ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-fg-muted">
                        {modality?.name ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-fg">
                        {fmtMoney(p.amount)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-fg-muted">
                        {fmtMoney(accumByPaymentId.get(p.id) ?? 0)}
                      </td>
                      <td className="px-3 py-3 text-fg-muted">
                        {p.notes ?? ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
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
