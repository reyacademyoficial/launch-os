import type { Metadata } from "next";
import Link from "next/link";

import { LaunchFormModal } from "@/components/dashboard/launches/launch-form-modal";
import { StatusBadge } from "@/components/dashboard/launches/status-badge";
import {
  fmtLaunchWindow,
  fmtMoney,
  fmtMoneyDecimals,
  fmtMultiplier,
  fmtNumber,
  fmtPercent,
} from "@/lib/format";
import { calculateLaunchKPIs } from "@/lib/kpis";
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
import { userCanEditProject } from "@/lib/supabase/auth";

import { createLaunch } from "./launches/actions";

export const metadata: Metadata = { title: "Overview" };

const RECENT_LIMIT = 5;

export default async function OverviewPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
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
    userCanEditProject(projectId),
    listAggregatesForProject(projectId),
    getKanbanSalesAggregatesForProject(projectId),
    listPaymentMethods(projectId),
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
  const fAgg = aggInUsd ? fmtUsd : fmtMoney;
  const fAggDec = aggInUsd ? fmtUsd : fmtMoneyDecimals;
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

  const profitColor = agg.totalProfit >= 0 ? "text-success" : "text-error";
  const roasColor = agg.aggregateROAS >= 1 ? "text-success" : "text-error";
  const recent = launches.slice(0, RECENT_LIMIT);

  return (
    <section className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{name}</h1>
          {project?.business_name && (
            <p className="mt-1 text-sm text-fg-subtle">{project.business_name}</p>
          )}
          <p className="mt-2 text-xs text-fg-muted">
            <span className="text-fg">{fmtNumber(agg.launchCount)}</span> lanzamientos
            <span className="mx-2 text-fg-subtle">·</span>
            <span className="text-success">{fmtNumber(agg.activeCount)}</span> activos
            <span className="mx-2 text-fg-subtle">·</span>
            <span className="text-fg-subtle">
              {fmtNumber(agg.finalizedCount)} finalizados
            </span>
          </p>
        </div>
        <Link
          href={`/proyectos/${projectId}/launches`}
          className="text-sm text-fg-muted hover:text-fg"
        >
          Ver todos →
        </Link>
      </header>

      {/* Aggregate KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <AggCard label="Revenue total" value={fAgg(agg.totalRevenue)} />
        <AggCard label="Inversión total" value={fAgg(agg.totalInvestment)} />
        <AggCard
          label="Profit"
          value={fAgg(agg.totalProfit)}
          valueClassName={profitColor}
        />
        <AggCard
          label="ROAS agregado"
          value={fmtMultiplier(agg.aggregateROAS)}
          valueClassName={roasColor}
        />
        <AggCard
          label="CAC agregado"
          value={fAggDec(agg.aggregateCAC)}
          hint={`${fmtNumber(agg.totalVentas)} ventas totales`}
        />
        <AggCard
          label="Leads totales"
          value={fmtNumber(agg.totalLeads)}
          hint="Meta + Google + TikTok"
        />
        <AggCard
          label="Show rate agregado"
          value={fmtPercent(agg.aggregateShowRate)}
          hint={`${fmtNumber(agg.totalAsistentes)} de ${fmtNumber(agg.totalRegistrados)} reg.`}
        />
        <AggCard
          label="Close rate agregado"
          value={fmtPercent(agg.aggregateCloseRate)}
          hint={`${fmtNumber(agg.totalVentas)} de ${fmtNumber(agg.totalAsistentes)} asist.`}
        />
      </div>

      {/* Recent launches */}
      <section className="space-y-3">
        <header className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-fg">Últimos lanzamientos</h2>
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
        </header>

        <ul className="space-y-2">
          {recent.map((l) => {
            const launchRow = l as unknown as {
              ads_currency?: string;
            };
            const revenueRate = effectiveRateByLaunch.get(l.id) ?? null;
            const usdRevenue = revenueUsdMap.get(l.id);

            const lk = calculateLaunchKPIs(l, {
              adsAggregate: adsAggregates.get(l.id),
              kanbanSalesAggregate: kanbanSalesAggregates.get(l.id),
              adsRatePerUsd:
                launchRow.ads_currency === "ARS" && revenueRate
                  ? revenueRate
                  : null,
              kanbanPledgedUsd: usdRevenue?.pledgedUsd ?? null,
              kanbanCollectedUsd: usdRevenue?.collectedUsd ?? null,
              revenueRatePerUsd: revenueRate,
            });

            const fMoney = revenueRate ? fmtUsd : fmtMoney;

            return (
              <li key={l.id}>
                <Link
                  href={`/proyectos/${projectId}/launches/${l.id}`}
                  className="flex items-center justify-between gap-4 rounded-md border border-border bg-surface px-4 py-3 transition-colors hover:border-accent/40 hover:bg-bg-elevated"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-fg">{l.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
                      <span>{fmtLaunchWindow(l.date_start, l.date_end)}</span>
                      <span>·</span>
                      <StatusBadge status={l.status} />
                    </div>
                  </div>
                  <div className="hidden text-right sm:block">
                    <div className="text-xs text-fg-subtle">Revenue est.</div>
                    <div className="text-sm font-bold text-fg">{fMoney(lk.revenueEstimated)}</div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </section>
  );
}

function AggCard({
  label,
  value,
  hint,
  valueClassName = "text-fg",
}: {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly valueClassName?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <div className="text-xs uppercase tracking-wide text-fg-subtle">{label}</div>
      <div className={`mt-2 text-xl font-bold ${valueClassName}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-fg-muted">{hint}</div>}
    </div>
  );
}
