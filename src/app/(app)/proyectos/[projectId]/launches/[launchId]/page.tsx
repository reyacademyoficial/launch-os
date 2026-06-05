import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DeleteButton } from "@/components/dashboard/launches/delete-button";
import { KpiGrid } from "@/components/dashboard/launches/kpi-grid";
import { StatusBadge } from "@/components/dashboard/launches/status-badge";
import { fmtDate } from "@/lib/format";
import { calculateLaunchKPIs } from "@/lib/kpis";
import { getLaunch } from "@/lib/launches/get";
import { userCanEditProject } from "@/lib/supabase/auth";

import { deleteLaunch } from "../actions";

export const metadata: Metadata = { title: "Lanzamiento" };

export default async function LaunchDetailPage({
  params,
}: {
  readonly params: Promise<{ projectId: string; launchId: string }>;
}) {
  const { projectId, launchId } = await params;
  const [launch, canEdit] = await Promise.all([
    getLaunch(launchId),
    userCanEditProject(projectId),
  ]);

  if (!launch || launch.project_id !== projectId) notFound();

  const kpi = calculateLaunchKPIs(launch);
  const deleteAction = deleteLaunch.bind(null, projectId, launchId);

  return (
    <section className="space-y-8">
      <div className="text-xs text-fg-subtle">
        <Link href={`/proyectos/${projectId}/launches`} className="hover:text-fg">
          ← Volver al listado
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
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
        </div>

        {canEdit && (
          <div className="flex items-center gap-3">
            <Link
              href={`/proyectos/${projectId}/launches/${launchId}/edit`}
              className="inline-flex items-center justify-center rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-fg hover:bg-bg-elevated"
            >
              Editar
            </Link>
            <DeleteButton launchName={launch.name} onConfirm={deleteAction} />
          </div>
        )}
      </header>

      <KpiGrid kpi={kpi} />
    </section>
  );
}
