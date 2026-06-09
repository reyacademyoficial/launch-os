import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AISummary } from "@/components/dashboard/launches/ai-summary";
import { DailyChart } from "@/components/dashboard/launches/daily/daily-chart";
import { DailyFormModal } from "@/components/dashboard/launches/daily/daily-form-modal";
import { DailyTable } from "@/components/dashboard/launches/daily/daily-table";
import { DeleteButton } from "@/components/dashboard/launches/delete-button";
import { KpiGrid } from "@/components/dashboard/launches/kpi-grid";
import { StatusBadge } from "@/components/dashboard/launches/status-badge";
import { fmtDate, fmtLaunchWindow } from "@/lib/format";
import { calculateLaunchKPIs } from "@/lib/kpis";
import { listDailyForLaunch } from "@/lib/launch-daily/list";
import { getLaunch } from "@/lib/launches/get";
import { userCanEditLaunchesIn, userCanEditProject } from "@/lib/supabase/auth";

import {
  closeLaunch,
  deleteLaunch,
  duplicateLaunch,
  reopenLaunch,
} from "../actions";
import { createDailyEntry } from "./daily-actions";

export const metadata: Metadata = { title: "Lanzamiento" };

export default async function LaunchDetailPage({
  params,
}: {
  readonly params: Promise<{ projectId: string; launchId: string }>;
}) {
  const { projectId, launchId } = await params;
  // Dos scopes que necesitamos en esta página:
  //   - canEditLaunch  → "Editar", Cerrar/Reabrir, daily add/edit/delete.
  //     Admin + operador miembros del proyecto pasan por acá.
  //   - canEditProject → "Duplicar" y "Borrar" (CREATE/DELETE del launch).
  //     Solo admin/superadmin — el operador edita pero no crea ni borra.
  const [launch, canEditLaunchValue, canEditProjectValue, daily] = await Promise.all([
    getLaunch(launchId),
    userCanEditLaunchesIn(projectId),
    userCanEditProject(projectId),
    listDailyForLaunch(launchId),
  ]);

  if (!launch || launch.project_id !== projectId) notFound();

  const kpi = calculateLaunchKPIs(launch);
  const deleteAction = deleteLaunch.bind(null, projectId, launchId);
  const closeAction = closeLaunch.bind(null, projectId, launchId);
  const reopenAction = reopenLaunch.bind(null, projectId, launchId);
  const duplicateAction = duplicateLaunch.bind(null, projectId, launchId);
  const addDailyAction = createDailyEntry.bind(null, projectId, launchId);
  const isClosed = launch.closed_at !== null;
  const showAnyAction = canEditLaunchValue || canEditProjectValue;

  return (
    <section className="space-y-10">
      <div className="text-xs text-fg-subtle">
        <Link href={`/proyectos/${projectId}/launches`} className="hover:text-fg">
          ← Volver al listado
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">{launch.name}</h1>
          <div className="flex flex-wrap items-center gap-3 text-sm text-fg-muted">
            <span>{fmtLaunchWindow(launch.date_start, launch.date_end)}</span>
            {launch.type && (
              <>
                <span className="text-fg-subtle">·</span>
                <span>{launch.type}</span>
              </>
            )}
            <span className="text-fg-subtle">·</span>
            <StatusBadge status={launch.status} />
            {isClosed && (
              <>
                <span className="text-fg-subtle">·</span>
                <span className="rounded bg-fg-subtle/15 px-2 py-0.5 text-xs font-medium text-fg-muted">
                  Cerrado {fmtDate(launch.closed_at)}
                </span>
              </>
            )}
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

        {showAnyAction && (
          <div className="flex items-center gap-3">
            {canEditLaunchValue && (
              <Link
                href={`/proyectos/${projectId}/launches/${launchId}/edit`}
                className="inline-flex items-center justify-center rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-fg hover:bg-bg-elevated"
              >
                Editar
              </Link>
            )}
            {canEditProjectValue && (
              <form action={duplicateAction}>
                <button
                  type="submit"
                  className="inline-flex items-center justify-center rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-fg hover:bg-bg-elevated"
                >
                  Duplicar
                </button>
              </form>
            )}
            {canEditLaunchValue &&
              (isClosed ? (
                <form action={reopenAction}>
                  <button
                    type="submit"
                    className="inline-flex items-center justify-center rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-fg hover:bg-bg-elevated"
                  >
                    Reabrir
                  </button>
                </form>
              ) : (
                <form action={closeAction}>
                  <button
                    type="submit"
                    className="inline-flex items-center justify-center rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-fg hover:bg-bg-elevated"
                  >
                    Cerrar lanzamiento
                  </button>
                </form>
              ))}
            {canEditProjectValue && (
              <DeleteButton launchName={launch.name} onConfirm={deleteAction} />
            )}
          </div>
        )}
      </header>

      <KpiGrid kpi={kpi} />

      <section className="space-y-4">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-fg">Datos diarios</h2>
            <p className="text-xs text-fg-subtle">
              Leads por canal por día. Alimenta el gráfico de abajo.
            </p>
          </div>
          {canEditLaunchValue && !isClosed && (
            <DailyFormModal
              triggerLabel="+ Agregar día"
              title="Agregar día"
              submitLabel="Guardar"
              action={addDailyAction}
            />
          )}
          {canEditLaunchValue && isClosed && (
            <p className="text-xs text-fg-subtle">
              Lanzamiento cerrado — no se pueden cargar más datos.
            </p>
          )}
        </header>

        {daily.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-surface/40 p-8 text-center text-sm text-fg-muted">
            Sin datos diarios cargados.
            {canEditLaunchValue
              ? " Agregá uno para empezar a ver el gráfico de leads por canal."
              : " El admin u operador del proyecto los va a cargar."}
          </div>
        ) : (
          <>
            <DailyTable
              rows={daily}
              canEdit={canEditLaunchValue && !isClosed}
              projectId={projectId}
              launchId={launchId}
            />
            <div className="rounded-md border border-border bg-surface/40 p-4">
              <DailyChart rows={daily} />
            </div>
          </>
        )}
      </section>

      <AISummary projectId={projectId} launchId={launchId} />
    </section>
  );
}
