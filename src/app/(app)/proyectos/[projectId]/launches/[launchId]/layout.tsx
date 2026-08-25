import Link from "next/link";
import { notFound } from "next/navigation";

import { LaunchHeaderActions } from "@/components/dashboard/launches/launch-header-actions";
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
    <section className="min-w-0 space-y-6">
      {/*
        Breadcrumb estilo KG (kg-t7 microlabel). Reemplaza el link "← Volver al
        listado" en text-xs. El drawer del sidebar ya tiene "← Volver a Kingrow"
        y el ítem Lanzamientos, así que este breadcrumb queda como shortcut
        contextual dentro del launch.
      */}
      <Link
        href={`/proyectos/${projectId}/launches`}
        className="kg-t7 inline-flex items-center gap-1 hover:opacity-80"
        style={{ color: "var(--kg-text-3)" }}
      >
        ← Lanzamientos
      </Link>

      {/*
        Header al estilo KG:
          - Título en kg-t3 (matchea kg-t3 = 22px/800 usado en cards de módulo).
          - Chips fluidos con `flex-wrap` (fecha, tipo, status, closed, evergreen).
          - Acciones a la derecha en desktop; en mobile solo "Editar" + kebab
            con bottom-sheet (LaunchHeaderActions maneja el toggle).
        El `<header>` es `flex-col` en mobile y `md:flex-row` para que las
        acciones queden abajo del bloque de título en pantallas chicas — antes
        el `flex-wrap` las empujaba al final pero pegadas al borde derecho.
      */}
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          <h1
            className="kg-t3 break-words"
            style={{ color: "var(--kg-text-1)" }}
          >
            {launch.name}
          </h1>
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
            style={{ color: "var(--kg-text-2)" }}
          >
            <span>{fmtLaunchWindow(launch.date_start, launch.date_end)}</span>
            {launch.type && (
              <>
                <span style={{ color: "var(--kg-text-3)" }}>·</span>
                <span>{launch.type}</span>
              </>
            )}
            <span style={{ color: "var(--kg-text-3)" }}>·</span>
            <StatusBadge status={launch.status} />
            {isClosed && (
              <span className="rounded bg-fg-subtle/15 px-2 py-0.5 text-xs font-medium text-fg-muted">
                Cerrado {fmtDate(launch.closed_at)}
              </span>
            )}
            {isEvergreen &&
              (targetLaunch ? (
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
              ))}
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
          <LaunchHeaderActions
            launchName={launch.name}
            isClosed={isClosed}
            canEditLaunch={canEditLaunchValue}
            canEditProject={canEditProjectValue}
            pdfExecutiveUrl={`/api/proyectos/${projectId}/launches/${launchId}/report/executive`}
            pdfCommissionsUrl={`/api/proyectos/${projectId}/launches/${launchId}/report/commissions`}
            updateAction={updateAction}
            deleteAction={deleteAction}
            closeAction={closeAction}
            reopenAction={reopenAction}
            duplicateAction={duplicateAction}
            initial={launch}
            recycleTargetOptions={recycleTargetOptions}
          />
        )}
      </header>

      <LaunchTabs base={tabsBase} />

      <div>{children}</div>
    </section>
  );
}
