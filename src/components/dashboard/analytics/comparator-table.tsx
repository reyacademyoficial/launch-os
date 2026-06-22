import {
  fmtMoney,
  fmtMultiplier,
  fmtNumber,
  fmtPercentOrDash,
} from "@/lib/format";
import { calculateLaunchKPIs } from "@/lib/kpis";
import type { DailyAggregate } from "@/lib/launch-daily/aggregate";
import type { KanbanSalesAggregate } from "@/lib/launch-sales/aggregate";
import type { LaunchRow } from "@/lib/launches/types";

/**
 * Tabla wide del tab Comparador. Una fila por launch (filtrado), columnas
 * son los KPIs clave. Reusa `calculateLaunchKPIs` — los números son
 * idénticos a `kpi/page.tsx` del detalle del launch.
 */
export function ComparatorTable({
  launches,
  adsByLaunch,
  kanbanSalesByLaunch,
}: {
  readonly launches: readonly LaunchRow[];
  readonly adsByLaunch: ReadonlyMap<string, DailyAggregate>;
  readonly kanbanSalesByLaunch: ReadonlyMap<string, KanbanSalesAggregate>;
}) {
  if (launches.length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        Sin lanzamientos en el filtro actual.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[1200px] text-sm">
        <thead className="bg-surface text-left text-xs uppercase tracking-wide text-fg-subtle">
          <tr>
            <th className="px-3 py-3 font-medium">Lanzamiento</th>
            <th className="px-3 py-3 text-right font-medium">Inversión</th>
            <th className="px-3 py-3 text-right font-medium">Leads</th>
            <th className="px-3 py-3 text-right font-medium">CPL promedio</th>
            <th className="px-3 py-3 text-right font-medium">Show rate</th>
            <th className="px-3 py-3 text-right font-medium">Close rate</th>
            <th className="px-3 py-3 text-right font-medium">Ventas</th>
            <th className="px-3 py-3 text-right font-medium">Revenue est.</th>
            <th className="px-3 py-3 text-right font-medium">Revenue cobr.</th>
            <th className="px-3 py-3 text-right font-medium">ROAS est.</th>
            <th className="px-3 py-3 text-right font-medium">ROAS real</th>
            <th className="px-3 py-3 text-right font-medium">Profit est.</th>
          </tr>
        </thead>
        <tbody>
          {launches.map((l) => {
            const adsAggregate = adsByLaunch.get(l.id);
            const kanbanSalesAggregate = kanbanSalesByLaunch.get(l.id);
            const kpi = calculateLaunchKPIs(l, {
              adsAggregate,
              kanbanSalesAggregate,
            });
            const cplAvg =
              kpi.totalLeads > 0 ? kpi.totalInvestment / kpi.totalLeads : 0;
            const profitColor =
              kpi.profitEstimated > 0
                ? "text-success"
                : kpi.profitEstimated < 0
                  ? "text-error"
                  : "text-fg";

            return (
              <tr key={l.id} className="border-t border-border hover:bg-surface">
                <td className="px-3 py-3 font-medium text-fg">{l.name}</td>
                <td className="px-3 py-3 text-right tabular-nums text-fg">
                  {fmtMoney(kpi.totalInvestment)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-fg">
                  {fmtNumber(kpi.totalLeads)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-fg-muted">
                  {fmtMoney(cplAvg)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-fg-muted">
                  {fmtPercentOrDash(kpi.showRate)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-fg-muted">
                  {fmtPercentOrDash(kpi.closeRate)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-fg">
                  {fmtNumber(kpi.ventas)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-fg">
                  {fmtMoney(kpi.revenueEstimated)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-fg">
                  {fmtMoney(kpi.revenueCollected)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-fg-muted">
                  {fmtMultiplier(kpi.roasEstimated)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-fg-muted">
                  {fmtMultiplier(kpi.roasReal)}
                </td>
                <td
                  className={`px-3 py-3 text-right tabular-nums ${profitColor}`}
                >
                  {fmtMoney(kpi.profitEstimated)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
