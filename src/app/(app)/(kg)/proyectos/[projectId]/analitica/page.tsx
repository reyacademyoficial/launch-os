import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AnalyticsFilters } from "@/components/dashboard/analytics/analytics-filters";
import { ChannelsTables } from "@/components/dashboard/analytics/channels-tables";
import { ComparatorTable } from "@/components/dashboard/analytics/comparator-table";
import { FunnelChart } from "@/components/dashboard/analytics/funnel-chart";
import {
  TrendsChart,
  type TrendsPoint,
} from "@/components/dashboard/analytics/trends-chart";
import { ContextBar } from "@/components/kg/context-bar";
import { KgTabsBarView } from "@/components/kg/tabs-bar-view";
import { IconLaunch } from "@/components/kg/icons";
import {
  applyAnalyticsFilter,
  parseAnalyticsFilter,
} from "@/lib/analytics/filter";
import { getChannelsData } from "@/lib/analytics/channels";
import { getFunnelData } from "@/lib/analytics/funnel";
import { fCount } from "@/lib/finance/format";
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
    <div className="flex flex-col gap-5">
      {/*
        Los filtros y las tabs scrollean fuera de vista en tablas largas, así
        que la barra repite el estado que cambia lo que se está leyendo: cuánto
        del proyecto entra en el filtro y qué vista está activa.
      */}
      <ContextBar
        icon={<IconLaunch size={16} />}
        title="Analítica"
        stats={[
          { l: "Lanzamientos", v: fCount(launches.length) },
          {
            // Warning cuando el filtro recorta: evita leer un subconjunto
            // creyendo que son los números del proyecto entero.
            l: "En el filtro",
            v: fCount(filtered.length),
            c: filtered.length < launches.length ? "#FFB800" : undefined,
          },
          { l: "Vista", v: VIEW_LABELS[view] },
        ]}
      />

      {/*
        No renderiza nada acá: se registra en el contexto de `page-menu` y
        aparece al tocar "Filtros" en el ContextBar (drawer en desktop,
        bottom-sheet en mobile). Se deja en esta posición del árbol porque es
        donde el lector espera encontrar "los filtros de esta página".
      */}
      <AnalyticsFilters
        launches={launchesForFilter}
        initialDateFrom={filter.dateFrom ?? ""}
        initialDateTo={filter.dateTo ?? ""}
        initialLaunchIds={initialLaunchIds}
      />

      {/*
        Pestañas de vista. Usa `KgTabsBarView` (la mitad presentacional de
        `KgTabsBar`) porque acá las pestañas NO son rutas sino valores de
        `?view=` sobre el mismo pathname: el resolvedor por `usePathname`
        marcaría siempre la misma. Al pasarle el `activeHref` explícito, la
        barra se renderiza en el server y no manda JS al browser.
      */}
      <KgTabsBarView
        ariaLabel="Vista de analítica"
        activeHref={viewHref(projectId, view, sp)}
        items={VIEWS.map((v) => ({
          href: viewHref(projectId, v, sp),
          label: VIEW_LABELS[v],
        }))}
      />

      {/*
        Cada vista trae su propio `Panel` (o dos, en Canales y Tendencias) —
        por eso acá solo hace falta el flujo vertical con el gap del DS.
      */}
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
  );
}

function readView(raw: string | string[] | undefined): View {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (VIEWS as ReadonlyArray<string>).includes(v ?? "")
    ? (v as View)
    : "comparador";
}

/**
 * ═════════════════════════════════════════════════════════════════════════
 * POR QUÉ ESTAS TABS NO SON `KgTabsBar`
 * ═════════════════════════════════════════════════════════════════════════
 * `KgTabsBar` decide cuál está activa con `usePathname()` + match por
 * prefijo. Estas cuatro vistas NO son rutas: son valores de `?view=` sobre
 * un mismo pathname. Con ese matcher, "Comparador" (cuyo href no lleva
 * `view`) quedaría marcada siempre, y en cuanto hubiera un filtro activo su
 * href pasaría a llevar querystring y no matchearía NADA — ninguna pestaña
 * pintada. Es una limitación real del componente, no algo que se arregle
 * eligiendo mejor los hrefs, y `tabs-bar.tsx` está fuera del alcance de esta
 * migración.
 *
 * Así que la barra se arma acá con el MISMO contrato visual de `KgTabsBar`
 * (contenedor pill sobre `--kg-surface-2-solid`, pill activa en
 * `--kg-accent-500` con texto blanco, mismos tamaños y roles ARIA) pero con
 * el activo resuelto en el SERVER a partir del `view` ya parseado. Efecto
 * lateral bueno: cero JS de cliente para navegar entre vistas, contra el
 * `usePathname` que `KgTabsBar` obliga a hidratar.
 *
 * Lo de abajo reemplaza al `border-b-2 border-accent` sobre `border-border` /
 * `text-fg-muted` — los tokens que estamos deprecando.
 */

/**
 * Href de una vista preservando los filtros activos (from/to/launches).
 *
 * Es navegación CON ESTADO: si esto se pierde, cambiar de pestaña resetea en
 * silencio el recorte que el usuario venía leyendo. NO se toca.
 *
 * "comparador" es la vista default, así que va sin `?view=` — mantiene la URL
 * limpia y hace que la raíz del módulo y la pestaña compartan el mismo href,
 * que es justo lo que `KgTabsBarView` compara para marcar la activa.
 */
function viewHref(
  projectId: string,
  tab: View,
  sp: Record<string, string | string[] | undefined>,
): string {
  const params = new URLSearchParams();
  const carry = ["from", "to", "launches"] as const;
  for (const key of carry) {
    const v = sp[key];
    const value = Array.isArray(v) ? v[0] : v;
    if (value) params.set(key, value);
  }
  if (tab !== "comparador") params.set("view", tab);
  const qs = params.toString();
  return `/proyectos/${projectId}/analitica${qs ? `?${qs}` : ""}`;
}
