import type { Metadata } from "next";
import Link from "next/link";

import { StatusBadge } from "@/components/dashboard/launches/status-badge";
import {
  fmtLaunchWindow,
  fmtMoney,
  fmtMoneyDecimals,
  fmtMultiplier,
  fmtNumber,
  fmtPercent,
} from "@/lib/format";
import { listLaunchesForProject } from "@/lib/launches/list";
import { aggregateProjectKPIs } from "@/lib/projects/aggregates";
import { createClient } from "@/lib/supabase/server";
import { userCanEditProject } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "Overview" };

const RECENT_LIMIT = 5;

export default async function OverviewPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();

  const [{ data: projectRaw }, launches, canEdit] = await Promise.all([
    supabase
      .from("projects")
      .select("name, business_name")
      .eq("id", projectId)
      .maybeSingle(),
    listLaunchesForProject(projectId),
    userCanEditProject(projectId),
  ]);

  const project = projectRaw as { name: string; business_name: string | null } | null;
  const name = project?.name ?? "Proyecto";
  const agg = aggregateProjectKPIs(launches);

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
          <Link
            href={`/proyectos/${projectId}/launches/new`}
            className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            Crear primer lanzamiento
          </Link>
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
        <AggCard label="Revenue total" value={fmtMoney(agg.totalRevenue)} />
        <AggCard label="Inversión total" value={fmtMoney(agg.totalInvestment)} />
        <AggCard
          label="Profit"
          value={fmtMoney(agg.totalProfit)}
          valueClassName={profitColor}
        />
        <AggCard
          label="ROAS agregado"
          value={fmtMultiplier(agg.aggregateROAS)}
          valueClassName={roasColor}
        />
        <AggCard
          label="CAC agregado"
          value={fmtMoneyDecimals(agg.aggregateCAC)}
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
            <Link
              href={`/proyectos/${projectId}/launches/new`}
              className="text-xs font-medium text-accent hover:opacity-80"
            >
              + Nuevo
            </Link>
          )}
        </header>

        <ul className="space-y-2">
          {recent.map((l) => (
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
                  <div className="text-xs text-fg-subtle">Revenue</div>
                  <div className="text-sm font-bold text-fg">{fmtMoney(l.revenue)}</div>
                </div>
              </Link>
            </li>
          ))}
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
