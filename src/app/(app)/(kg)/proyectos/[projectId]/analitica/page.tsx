import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AnalyticsFilters } from "@/components/dashboard/analytics/analytics-filters";
import { ChannelsTables } from "@/components/dashboard/analytics/channels-tables";
import { ComparatorTable } from "@/components/dashboard/analytics/comparator-table";
import { FunnelChart } from "@/components/dashboard/analytics/funnel-chart";
import {
  TrendsChart,
  type TrendsPoint,
} from "@/components/dashboard/analytics/trends-chart";
import {
  applyAnalyticsFilter,
  parseAnalyticsFilter,
} from "@/lib/analytics/filter";
import { getChannelsData } from "@/lib/analytics/channels";
import { getFunnelData } from "@/lib/analytics/funnel";
import { calculateLaunchKPIs } from "@/lib/kpis";
import { listAggregatesForProject } from "@/lib/launch-daily/list";
import { getKanbanSalesAggregatesForProject } from "@/lib/launch-sales/list";
import { listLaunchesForProject } from "@/lib/launches/list";
import {
  denyCloserOutsideVentas,
  requireSessionProfile,
} from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "Analítica" };

type View = "comparador" | "embudo" | "tendencias" | "canales";
const VIEWS: ReadonlyArray<View> = [
  "comparador",
  "embudo",
  "tendencias",
  "canales",
];
const VIEW_LABELS: Record<View, string> = {
  comparador: "Comparador",
  embudo: "Embudo",
  tendencias: "Tendencias",
  canales: "Canales",
};

/**
 * Hub de analítica avanzada (Fase 8b). 4 tabs read-only sobre datos
 * existentes:
 *   - Comparador: KPIs lado a lado por launch.
 *   - Embudo: 3 etapas (Lead → Agendado → Vendido).
 *   - Tendencias: line chart cross-launches.
 *   - Canales: 2 tablas (canal pago + origen del lead, con reciclados como
 *     dimensión sintética).
 *
 * Equipo only — cliente_role hace bounce. La portal del cliente tiene su
 * propia vista (Fase 6).
 *
 * Filtros compartidos: rango de fecha por `date_start` + multi-select de
 * launches. Vacío = todos los launches del proyecto.
 */
export default async function AnalyticsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ projectId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;

  const profile = await requireSessionProfile();
  if (profile.role === "cliente") redirect(`/portal/proyectos/${projectId}`);
  denyCloserOutsideVentas(profile, projectId);

  const view = readView(sp.view);
  const filter = parseAnalyticsFilter(sp);

  const [launches, adsByLaunch, kanbanSalesByLaunch] = await Promise.all([
    listLaunchesForProject(projectId),
    listAggregatesForProject(projectId),
    getKanbanSalesAggregatesForProject(projectId),
  ]);

  const filtered = applyAnalyticsFilter(launches, filter);
  const filteredIds = filtered.map((l) => l.id);
  const initialLaunchIds = filter.launchIds
    ? Array.from(filter.launchIds)
    : [];

  // Datos específicos del tab activo. Solo fetcheamos lo que la vista usa.
  let funnel = null;
  let channels = null;
  let trends: TrendsPoint[] | null = null;

  if (view === "embudo") {
    funnel = await getFunnelData({
      projectId,
      // Si no hay launches filtrados, igual mostramos el funnel total del
      // proyecto. Si hay filtro, restringimos.
      launchIds: filter.launchIds || filter.dateFrom || filter.dateTo
        ? filteredIds
        : null,
    });
  } else if (view === "canales") {
    channels = await getChannelsData({
      projectId,
      launchIds: filter.launchIds || filter.dateFrom || filter.dateTo
        ? filteredIds
        : null,
      adsByLaunch,
    });
  } else if (view === "tendencias") {
    // Para tendencias necesitamos ordenado por date_start ASC (más viejo
    // primero) — el comparador viene DESC desde listLaunchesForProject.
    const ascending = [...filtered].sort((a, b) => {
      const ad = a.date_start ?? "9999-12-31";
      const bd = b.date_start ?? "9999-12-31";
      return ad.localeCompare(bd);
    });
    trends = ascending.map((l) => {
      const kpi = calculateLaunchKPIs(l, {
        adsAggregate: adsByLaunch.get(l.id),
        kanbanSalesAggregate: kanbanSalesByLaunch.get(l.id),
      });
      const cpl =
        kpi.totalLeads > 0 ? kpi.totalInvestment / kpi.totalLeads : 0;
      return {
        launchId: l.id,
        name: l.name,
        dateStart: l.date_start,
        revenue: kpi.revenueEstimated,
        profit: kpi.profitEstimated,
        cpl,
        // El chart no puede plotear null — un launch sin asistentes_clase_1
        // se grafica como 0% en la serie. La tabla comparador sí distingue
        // "—" vs "0%".
        closeRate: kpi.closeRate ?? 0,
      };
    });
  }

  const launchesForFilter = launches.map((l) => ({ id: l.id, name: l.name }));

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Analítica</h1>
          <p className="mt-1 text-xs text-fg-subtle">
            {filtered.length} de {launches.length} lanzamientos en el filtro
          </p>
        </div>
      </header>

      <AnalyticsFilters
        launches={launchesForFilter}
        initialDateFrom={filter.dateFrom ?? ""}
        initialDateTo={filter.dateTo ?? ""}
        initialLaunchIds={initialLaunchIds}
      />

      <nav className="flex gap-1 border-b border-border" aria-label="Vista de analítica">
        {VIEWS.map((v) => (
          <TabLink key={v} projectId={projectId} tab={v} current={view} sp={sp} />
        ))}
      </nav>

      <div>
        {view === "comparador" && (
          <ComparatorTable
            launches={filtered}
            adsByLaunch={adsByLaunch}
            kanbanSalesByLaunch={kanbanSalesByLaunch}
          />
        )}
        {view === "embudo" && funnel && <FunnelChart stages={funnel.stages} />}
        {view === "tendencias" && trends && <TrendsChart points={trends} />}
        {view === "canales" && channels && <ChannelsTables data={channels} />}
      </div>
    </section>
  );
}

function readView(raw: string | string[] | undefined): View {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (VIEWS as ReadonlyArray<string>).includes(v ?? "")
    ? (v as View)
    : "comparador";
}

function TabLink({
  projectId,
  tab,
  current,
  sp,
}: {
  readonly projectId: string;
  readonly tab: View;
  readonly current: View;
  readonly sp: Record<string, string | string[] | undefined>;
}) {
  // Preservamos los filtros (from/to/launches) al cambiar de tab.
  const params = new URLSearchParams();
  const carry = ["from", "to", "launches"] as const;
  for (const key of carry) {
    const v = sp[key];
    const s = Array.isArray(v) ? v[0] : v;
    if (s) params.set(key, s);
  }
  if (tab !== "comparador") params.set("view", tab);
  const qs = params.toString();
  const href = `/proyectos/${projectId}/analitica${qs ? `?${qs}` : ""}`;
  const isActive = tab === current;
  return (
    <Link
      href={href}
      className={
        "border-b-2 px-3 py-2 text-sm font-medium " +
        (isActive
          ? "border-accent text-accent"
          : "border-transparent text-fg-muted hover:text-fg")
      }
    >
      {VIEW_LABELS[tab]}
    </Link>
  );
}
