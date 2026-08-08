import Link from "next/link";
import { notFound } from "next/navigation";

import { DeleteButton } from "@/components/dashboard/launches/delete-button";
import { LaunchFormModal } from "@/components/dashboard/launches/launch-form-modal";
import { LaunchTabs } from "@/components/dashboard/launches/launch-tabs";
import { StatusBadge } from "@/components/dashboard/launches/status-badge";
import { fmtDate, fmtLaunchWindow } from "@/lib/format";
import { listEvergreensTargeting } from "@/lib/launches/evergreen";
import { getLaunch } from "@/lib/launches/get";
import { listLaunchesForProject } from "@/lib/launches/list";
import { userCanEditLaunchesIn, userCanEditProject } from "@/lib/supabase/auth";

import {
  closeLaunch,
  deleteLaunch,
  duplicateLaunch,
  reopenLaunch,
  updateLaunch,
} from "../actions";

/**
 * Layout del detalle del launch.
 *
 * Hace el fetch del launch + scopes de edición y renderiza el header (metadata
 * + acciones) y el tab nav. Cada sub-page bajo este layout (kpi/, calendario/,
 * integraciones/, ia/) fetchea solo los datos de su tab.
 *
 * El page.tsx raíz redirige a ./kpi.
 */
export default async function LaunchLayout({
  children,
  params,
}: {
  readonly children: React.ReactNode;
  readonly params: Promise<{ projectId: string; launchId: string }>;
}) {
  const { projectId, launchId } = await params;

  const [
    launch,
    canEditLaunchValue,
    canEditProjectValue,
    allLaunches,
    evergreenSources,
  ] = await Promise.all([
    getLaunch(launchId),
    userCanEditLaunchesIn(projectId),
    userCanEditProject(projectId),
    listLaunchesForProject(projectId),
    listEvergreensTargeting(launchId),
  ]);

  if (!launch || launch.project_id !== projectId) notFound();

  const updateAction = updateLaunch.bind(null, projectId, launchId);
  const deleteAction = deleteLaunch.bind(null, projectId, launchId);
  const closeAction = closeLaunch.bind(null, projectId, launchId);
  const reopenAction = reopenLaunch.bind(null, projectId, launchId);
  const duplicateAction = duplicateLaunch.bind(null, projectId, launchId);
  const isClosed = launch.closed_at !== null;
  const showAnyAction = canEditLaunchValue || canEditProjectValue;

  const isEvergreen = launch.is_evergreen ?? false;
  const targetLaunchId = launch.recycle_target_launch_id ?? null;
  const targetLaunch = targetLaunchId
    ? allLaunches.find((l) => l.id === targetLaunchId) ?? null
    : null;
  // Opciones del select del target: todos los launches del proyecto menos
  // el actual (no se puede reciclar a sí mismo — además del check del DB).
  const recycleTargetOptions = allLaunches
    .filter((l) => l.id !== launchId)
    .map((l) => ({ id: l.id, name: l.name }));

  const tabsBase = `/proyectos/${projectId}/launches/${launchId}`;

  return (
    <section className="space-y-6">
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
            {isEvergreen && (
              <>
                <span className="text-fg-subtle">·</span>
                {targetLaunch ? (
                  <span className="rounded bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                    Evergreen → {targetLaunch.name}
                  </span>
                ) : (
                  <span
                    title="Configurá el lanzamiento destino para que el reciclado funcione al cerrar."
                    className="rounded bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning"
                  >
                    Evergreen sin destino
                  </span>
                )}
              </>
            )}
          </div>
          {evergreenSources.length > 0 && (
            <p className="pt-1 text-xs text-fg-muted">
              ↩ Recibe reciclado de{" "}
              {evergreenSources.map((src, i) => (
                <span key={src.id}>
                  <Link
                    href={`/proyectos/${projectId}/launches/${src.id}`}
                    className="text-accent hover:underline"
                  >
                    {src.name}
                  </Link>
                  {i < evergreenSources.length - 1 ? ", " : ""}
                </span>
              ))}
            </p>
          )}
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
              <a
                href={`/api/proyectos/${projectId}/launches/${launchId}/report/executive`}
                className="inline-flex items-center justify-center rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-fg hover:bg-bg-elevated"
              >
                ⬇ PDF ejecutivo
              </a>
            )}
            {canEditProjectValue && (
              <a
                href={`/api/proyectos/${projectId}/launches/${launchId}/report/commissions`}
                className="inline-flex items-center justify-center rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-fg hover:bg-bg-elevated"
              >
                ⬇ PDF comisiones
              </a>
            )}
            {canEditLaunchValue && (
              <LaunchFormModal
                triggerLabel="Editar"
                triggerVariant="secondary"
                title="Editar lanzamiento"
                submitLabel="Guardar cambios"
                action={updateAction}
                initial={launch}
                recycleTargetOptions={recycleTargetOptions}
              />
            )}
            {canEditLaunchValue && (
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
            {canEditLaunchValue && (
              <DeleteButton launchName={launch.name} onConfirm={deleteAction} />
            )}
          </div>
        )}
      </header>

      <LaunchTabs base={tabsBase} />

      <div>{children}</div>
    </section>
  );
}
