import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LaunchFormModal } from "@/components/dashboard/launches/launch-form-modal";
import { ContextBar } from "@/components/kg/context-bar";
import { KgDataTable, type Column } from "@/components/kg/data-table";
import { IconLaunch } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { StatusPill } from "@/components/kg/status-pill";
import { fmtLaunchWindow, fmtMoney, fmtNumber } from "@/lib/format";
import { calculateLaunchKPIs } from "@/lib/kpis";
import { launchStatusTone } from "@/lib/launches/status-tone";
import type { LaunchStatus } from "@/lib/launches/types";
import { listAggregatesForProject } from "@/lib/launch-daily/list";
import {
  getKanbanSalesAggregatesForProject,
  getProjectRevenueUsdMap,
} from "@/lib/launch-sales/list";
import { listLaunchesForProject } from "@/lib/launches/list";
import {
  fmtUsd,
  loadProjectFxRates,
  resolveLaunchFallbackRate,
} from "@/lib/money";
import { listBanks } from "@/lib/banks/list";
import { listPaymentMethods } from "@/lib/payment-methods/list";
import { aggregateProjectKPIs } from "@/lib/projects/aggregates";
import { createClient } from "@/lib/supabase/server";
import {
  denyCloserOutsideVentas,
  requireSessionProfile,
  userCanEditLaunchesIn,
} from "@/lib/supabase/auth";

import { createLaunch } from "./launches/actions";
import { OverviewKpis } from "./overview-kpis";

export const metadata: Metadata = { title: "Overview" };

const RECENT_LIMIT = 5;

/** Fila ya resuelta de la tabla "Últimos lanzamientos". */
interface RecentLaunchRow {
  readonly id: string;
  readonly name: string;
  readonly window: string;
  readonly status: LaunchStatus | string | null;
  /** Monto YA formateado — el formateador depende del FX de cada launch. */
  readonly revenueEstimated: string;
}

export default async function OverviewPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  // Regla 2026-08-08: operador va directo al listado de launches — sin
  // overview con KPIs agregados de revenue/profit del proyecto.
  // Regla 2026-08-28: closer no ve overview; va directo a Ventas.
  const profile = await requireSessionProfile();
  if (profile.role === "operador") {
    redirect(`/proyectos/${projectId}/launches`);
  }
  denyCloserOutsideVentas(profile, projectId);

  const supabase = await createClient();

  const [
    { data: projectRaw },
    launches,
    canEdit,
    adsAggregates,
    kanbanSalesAggregates,
    paymentMethods,
    banks,
    fxMap,
  ] = await Promise.all([
    supabase
      .from("projects")
      .select("name, business_name")
      .eq("id", projectId)
      .maybeSingle(),
    listLaunchesForProject(projectId),
    userCanEditLaunchesIn(projectId),
    listAggregatesForProject(projectId),
    getKanbanSalesAggregatesForProject(projectId),
    listPaymentMethods(),
    listBanks(),
    loadProjectFxRates(supabase, projectId),
  ]);

  const project = projectRaw as { name: string; business_name: string | null } | null;
  const name = project?.name ?? "Proyecto";

  // Tasa efectiva por launch: propia o mensual del mes anchor.
  const effectiveRateByLaunch = new Map(
    launches.map(
      (l) =>
        [
          l.id,
          resolveLaunchFallbackRate(
            l as unknown as {
              ars_per_usd?: number | null;
              date_start?: string | null;
              date_end?: string | null;
            },
            fxMap,
          ),
        ] as const,
    ),
  );

  const launchesForFx = launches.map((l) => {
    const row = l as unknown as {
      ars_per_usd?: number | null;
      date_start?: string | null;
      date_end?: string | null;
    };
    return {
      id: l.id,
      ars_per_usd: row.ars_per_usd ?? null,
      date_start: row.date_start ?? null,
      date_end: row.date_end ?? null,
    };
  });
  const revenueUsdMap = await getProjectRevenueUsdMap(
    projectId,
    launchesForFx,
    fxMap,
    paymentMethods as unknown as Array<{
      id: string;
      bank_id: string | null;
      currency: "ARS" | "USD" | null;
    }>,
    banks as unknown as Array<{ id: string; currency: "ARS" | "USD" }>,
  );

  const agg = aggregateProjectKPIs(
    launches,
    adsAggregates,
    kanbanSalesAggregates,
    revenueUsdMap,
    effectiveRateByLaunch,
  );
  // Los KPIs se muestran en USD cuando hay al menos un launch con tasa
  // efectiva (propia o mensual). Si ningún launch tiene tasa, todo queda en
  // moneda cruda (probablemente ARS).
  const aggInUsd = Array.from(effectiveRateByLaunch.values()).some(
    (r) => r !== null,
  );
  // El par de formateadores USD/local ya no vive acá: se eligen del lado
  // client en `OverviewKpis`, que solo recibe `inUsd`.
  const createAction = createLaunch.bind(null, projectId);
  const copyableLaunches = launches.map((l) => ({ id: l.id, name: l.name }));

  if (agg.launchCount === 0) {
    return (
      <section className="max-w-md space-y-4">
        <header>
          <h1 className="text-2xl font-bold">{name}</h1>
          {project?.business_name && (
            <p className="mt-1 text-sm text-fg-subtle">{project.business_name}</p>
          )}
        </header>
        <p className="text-sm text-fg-muted">
          Sin lanzamientos cargados todavía
          {canEdit ? "." : ". Pedile al admin que cree el primero."}
        </p>
        {canEdit && (
          <LaunchFormModal
            triggerLabel="Crear primer lanzamiento"
            title="Nuevo lanzamiento"
            submitLabel="Crear lanzamiento"
            action={createAction}
          />
        )}
      </section>
    );
  }

  const recent = launches.slice(0, RECENT_LIMIT);

  // Filas de la tabla de "Últimos lanzamientos". El KPI por lanzamiento se
  // resuelve acá (y no dentro de la columna) porque `calculateLaunchKPIs`
  // necesita los mapas de FX y de agregados que ya trajo esta page; la
  // columna solo formatea lo que le llega.
  const recentRows: readonly RecentLaunchRow[] = recent.map((l) => {
    const launchRow = l as unknown as { ads_currency?: string };
    const revenueRate = effectiveRateByLaunch.get(l.id) ?? null;
    const usdRevenue = revenueUsdMap.get(l.id);

    const lk = calculateLaunchKPIs(l, {
      adsAggregate: adsAggregates.get(l.id),
      kanbanSalesAggregate: kanbanSalesAggregates.get(l.id),
      adsRatePerUsd:
        launchRow.ads_currency === "ARS" && revenueRate ? revenueRate : null,
      kanbanPledgedUsd: usdRevenue?.pledgedUsd ?? null,
      kanbanCollectedUsd: usdRevenue?.collectedUsd ?? null,
      revenueRatePerUsd: revenueRate,
    });

    return {
      id: l.id,
      name: l.name,
      window: fmtLaunchWindow(l.date_start, l.date_end),
      status: l.status,
      // El formateador se elige por lanzamiento: si tiene tasa de revenue
      // cargada el monto ya está en USD, si no queda en moneda local.
      revenueEstimated: (revenueRate ? fmtUsd : fmtMoney)(lk.revenueEstimated),
    };
  });

  const recentColumns: ReadonlyArray<Column<RecentLaunchRow>> = [
    {
      key: "name",
      label: "Lanzamiento",
      render: (r) => (
        <Link
          href={`/proyectos/${projectId}/launches/${r.id}`}
          className="kg-focus"
          style={{
            color: "var(--kg-text-1)",
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          {r.name}
        </Link>
      ),
    },
    {
      key: "window",
      label: "Fecha",
      width: "230px",
      render: (r) => (
        <span style={{ color: "var(--kg-text-3)" }}>{r.window}</span>
      ),
    },
    {
      key: "status",
      label: "Status",
      width: "140px",
      render: (r) => <StatusPill text={r.status} tone={launchStatusTone(r.status)} />,
    },
    {
      key: "revenue",
      label: "Revenue est.",
      align: "right",
      numeric: true,
      width: "160px",
      render: (r) => r.revenueEstimated,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/*
        La barra lleva la FORMA del proyecto (cuántos lanzamientos, en qué
        estado, cuántas ventas), no su economía. La economía ya vive en las
        AggCards de abajo y repetirla acá sería leer dos veces el mismo
        número — el ContextBar del dashboard de Financiero sigue el mismo
        criterio: complementa a los HeroKpi, no los duplica.

        Estos contadores además reemplazan la línea "N lanzamientos · N
        activos · N finalizados" que antes colgaba del header y scrolleaba.
      */}
      <ContextBar
        icon={<IconLaunch size={16} />}
        title="Overview"
        stats={[
          { l: "Lanzamientos", v: fmtNumber(agg.launchCount) },
          { l: "Activos", v: fmtNumber(agg.activeCount) },
          { l: "Finalizados", v: fmtNumber(agg.finalizedCount) },
          { l: "Ventas totales", v: fmtNumber(agg.totalVentas) },
        ]}
      />

      <header>
        <h1 className="kg-t3" style={{ color: "var(--kg-text-1)" }}>
          {name}
        </h1>
        {project?.business_name && (
          <p className="mt-1 text-sm" style={{ color: "var(--kg-text-3)" }}>
            {project.business_name}
          </p>
        )}
      </header>

      {/*
        Los 8 AggCard locales pasaron a HeroKpi (Revenue, Profit) + SupportKpi
        (el resto). El corte a un componente client es obligado: esas
        primitivas reciben `format` como función y las funciones no cruzan el
        boundary RSC. Ver el comentario de `overview-kpis.tsx`.
      */}
      <OverviewKpis
        data={{
          totalRevenue: agg.totalRevenue,
          totalInvestment: agg.totalInvestment,
          totalProfit: agg.totalProfit,
          aggregateROAS: agg.aggregateROAS,
          aggregateCAC: agg.aggregateCAC,
          totalLeads: agg.totalLeads,
          aggregateShowRate: agg.aggregateShowRate,
          aggregateCloseRate: agg.aggregateCloseRate,
          totalVentas: agg.totalVentas,
          totalAsistentes: agg.totalAsistentes,
          totalRegistrados: agg.totalRegistrados,
          inUsd: aggInUsd,
        }}
      />

      {/*
        Últimos lanzamientos. La lista de <li> con links pasó a KgDataTable:
        el dato es tabular (nombre, ventana, status, revenue) y como tabla
        cierra verticalmente por columna en vez de repetir la etiqueta
        "Revenue est." en cada fila.

        El KPI de cada fila se calcula acá arriba (no en la columna) porque
        `calculateLaunchKPIs` necesita los mapas de FX y de agregados que ya
        trajo la page — la columna solo formatea.
      */}
      <Panel
        title="Últimos lanzamientos"
        pad={false}
        actions={
          <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <Link
              href={`/proyectos/${projectId}/launches`}
              className="kg-t7 kg-focus"
              style={{ color: "var(--kg-text-3)", textDecoration: "none" }}
            >
              Ver todos →
            </Link>
            {canEdit && (
              <LaunchFormModal
                triggerLabel="+ Nuevo"
                triggerVariant="secondary"
                triggerClassName="!px-2 !py-1 !text-xs"
                title="Nuevo lanzamiento"
                submitLabel="Crear lanzamiento"
                action={createAction}
                copyableLaunches={copyableLaunches}
                recycleTargetOptions={copyableLaunches}
              />
            )}
          </div>
        }
      >
        <KgDataTable
          columns={recentColumns}
          rows={recentRows}
          rowKey={(r) => r.id}
          emptyTitle="Sin lanzamientos todavía"
          emptyHint="Creá el primero para empezar a cargar inversión, leads y ventas."
        />
      </Panel>
    </div>
  );
}
