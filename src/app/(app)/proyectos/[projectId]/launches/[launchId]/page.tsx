import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { KpiGrid } from "@/components/dashboard/launches/kpi-grid";
import { StatusBadge } from "@/components/dashboard/launches/status-badge";
import { fmtDate } from "@/lib/format";
import { calculateLaunchKPIs } from "@/lib/kpis";
import { getLaunch } from "@/lib/launches/get";

export const metadata: Metadata = { title: "Lanzamiento" };

export default async function LaunchDetailPage({
  params,
}: {
  readonly params: Promise<{ projectId: string; launchId: string }>;
}) {
  const { projectId, launchId } = await params;
  const launch = await getLaunch(launchId);

  // RLS-or-missing both return null. notFound() lets Next render the right page.
  if (!launch || launch.project_id !== projectId) notFound();

  const kpi = calculateLaunchKPIs(launch);

  return (
    <section className="space-y-8">
      <div className="text-xs text-fg-subtle">
        <Link href={`/proyectos/${projectId}/launches`} className="hover:text-fg">
          ← Volver al listado
        </Link>
      </div>

      <header className="space-y-2">
        <h1 className="text-2xl font-bold">{launch.name}</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm text-fg-muted">
          <span>{fmtDate(launch.date)}</span>
          {launch.type && (
            <>
              <span className="text-fg-subtle">·</span>
              <span>{launch.type}</span>
            </>
          )}
          <span className="text-fg-subtle">·</span>
          <StatusBadge status={launch.status} />
        </div>
        {launch.platforms.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {launch.platforms.map((p) => (
              <span
                key={p}
                className="rounded bg-surface px-2 py-0.5 text-xs text-fg-muted"
              >
                {p}
              </span>
            ))}
          </div>
        )}
      </header>

      <KpiGrid kpi={kpi} />
    </section>
  );
}
