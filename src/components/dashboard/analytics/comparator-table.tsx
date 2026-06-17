import { fmtMoney, fmtMultiplier, fmtNumber, fmtPercent } from "@/lib/format";
import { calculateLaunchKPIs } from "@/lib/kpis";
import type { DailyAggregate } from "@/lib/launch-daily/aggregate";
import {
  aggregateOpportunities,
  EMPTY_SALES_AGGREGATE,
  type LaunchOpportunityRow,
} from "@/lib/launch-opportunities/aggregate";
import type { LaunchRow } from "@/lib/launches/types";

/**
 * Tabla wide del tab Comparador. Una fila por launch (filtrado), columnas
 * son los KPIs clave. Reusa `calculateLaunchKPIs` — los números son
 * idénticos a `kpi/page.tsx` del detalle del launch.
 */
export function ComparatorTable({
  launches,
  adsByLaunch,
  opportunityRowsByLaunch,
}: {
  readonly launches: readonly LaunchRow[];
  readonly adsByLaunch: ReadonlyMap<string, DailyAggregate>;
  readonly opportunityRowsByLaunch: ReadonlyMap<
    string,
    ReadonlyArray<LaunchOpportunityRow>
  >;
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
      <table className="w-full min-w-[1100px] text-sm">
        <thead className="bg-surface text-left text-xs uppercase tracking-wide text-fg-subtle">
          <tr>
            <th className="px-3 py-3 font-medium">Lanzamiento</th>
            <th className="px-3 py-3 text-right font-medium">Inversión</th>
            <th className="px-3 py-3 text-right font-medium">Leads</th>
            <th className="px-3 py-3 text-right font-medium">CPL promedio</th>
            <th className="px-3 py-3 text-right font-medium">Show rate</th>
            <th className="px-3 py-3 text-right font-medium">Close rate</th>
            <th className="px-3 py-3 text-right font-medium">Ventas</th>
            <th className="px-3 py-3 text-right font-medium">Revenue</th>
            <th className="px-3 py-3 text-right font-medium">ROAS</th>
            <th className="px-3 py-3 text-right font-medium">Profit</th>
          </tr>
        </thead>
        <tbody>
          {launches.map((l) => {
            const adsAggregate = adsByLaunch.get(l.id);
            const salesAggregate =
              l.date_start && l.date_end
                ? aggregateOpportunities(
                    opportunityRowsByLaunch.get(l.id) ?? [],
                    { date_start: l.date_start, date_end: l.date_end },
                  )
                : EMPTY_SALES_AGGREGATE;
            const kpi = calculateLaunchKPIs(l, { adsAggregate, salesAggregate });
            // CPL promedio = inversión total / leads totales. Más útil que el
            // promedio de CPL por canal cuando se comparan launches enteros.
            const cplAvg =
              kpi.totalLeads > 0 ? kpi.totalInvestment / kpi.totalLeads : 0;
            const profitColor =
              kpi.profit > 0
                ? "text-success"
                : kpi.profit < 0
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
                  {fmtPercent(kpi.showRate)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-fg-muted">
                  {fmtPercent(kpi.closeRate)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-fg">
                  {fmtNumber(kpi.ventas)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-fg">
                  {fmtMoney(kpi.revenue)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-fg-muted">
                  {fmtMultiplier(kpi.roas)}
                </td>
                <td
                  className={`px-3 py-3 text-right tabular-nums ${profitColor}`}
                >
                  {fmtMoney(kpi.profit)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
