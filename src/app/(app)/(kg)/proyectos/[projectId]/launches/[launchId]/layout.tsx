import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";

import { LaunchHeaderActions } from "@/components/dashboard/launches/launch-header-actions";
import { KgModuleNav } from "@/components/kg/module-nav";
import { StateDot } from "@/components/kg/state-dot";
import { StatusPill } from "@/components/kg/status-pill";
import type { TabItem } from "@/components/kg/tabs-bar";
import type { KgTone } from "@/components/kg/tone";
import { fmtDate, fmtLaunchWindow } from "@/lib/format";
import { listEvergreensTargeting } from "@/lib/launches/evergreen";
import { getLaunch } from "@/lib/launches/get";
import { listLaunchesForProject } from "@/lib/launches/list";
import { launchStatusTone } from "@/lib/launches/status-tone";
import {
  denyCloserOutsideVentas,
  requireSessionProfile,
  userCanEditLaunchesIn,
  userCanEditProject,
} from "@/lib/supabase/auth";

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

  // Closer no entra al detalle del launch — solo puede estar en Ventas/Cobros.
  const profile = await requireSessionProfile();
  denyCloserOutsideVentas(profile, projectId);

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

  // Tabs del lanzamiento. Reemplazan a las del proyecto mientras estás
  // adentro de un launch (`KgProjectNav` se auto-oculta acá) — una sola fila
  // de pestañas, con el breadcrumb "← Lanzamientos" arriba como vía de salida.
  const tabsBase = `/proyectos/${projectId}/launches/${launchId}`;
  const launchTabs: readonly TabItem[] = [
    { href: `${tabsBase}/kpi`, label: "KPI" },
    { href: `${tabsBase}/presupuesto`, label: "Presupuesto" },
    { href: `${tabsBase}/consumo`, label: "Consumo" },
    { href: `${tabsBase}/calendario`, label: "Calendario" },
    { href: `${tabsBase}/integraciones`, label: "Integraciones" },
    { href: `${tabsBase}/alertas`, label: "Alertas" },
    { href: `${tabsBase}/ia`, label: "IA" },
  ];

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

        Los chips pasaron de utilidades del token viejo (`bg-surface`,
        `bg-accent/10 text-accent`, `bg-warning/15 text-warning`) a `Chip`, que
        pinta con vars `--kg-*` y deja el color semántico en un StateDot: un
        chip tintado de rojo/ámbar al lado de otro tintado de carmesí lee como
        semáforo y compite con el título.
      */}
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          <h1
            className="kg-t3 break-words"
            style={{ color: "var(--kg-text-1)" }}
          >
            {launch.name}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Chip>{fmtLaunchWindow(launch.date_start, launch.date_end)}</Chip>
            {launch.type && <Chip>{launch.type}</Chip>}
            <Chip>
              <StatusPill
                text={launch.status}
                tone={launchStatusTone(launch.status)}
              />
            </Chip>
            {isClosed && <Chip>Cerrado {fmtDate(launch.closed_at)}</Chip>}
            {isEvergreen &&
              (targetLaunch ? (
                <Chip tone="accent">Evergreen → {targetLaunch.name}</Chip>
              ) : (
                <Chip
                  tone="warning"
                  title="Configurá el lanzamiento destino para que el reciclado funcione al cerrar."
                >
                  Evergreen sin destino
                </Chip>
              ))}
          </div>
          {evergreenSources.length > 0 && (
            <p className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
              ↩ Recibe reciclado de{" "}
              {evergreenSources.map((src, i) => (
                <span key={src.id}>
                  <Link
                    href={`/proyectos/${projectId}/launches/${src.id}`}
                    className="kg-focus hover:underline"
                    style={{ color: "var(--kg-accent-text)" }}
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
                <Chip key={p}>{p}</Chip>
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

      <KgModuleNav items={launchTabs} />

      <div>{children}</div>
    </section>
  );
}

/**
 * Chip de metadata del header. Superficie neutra siempre; cuando el dato
 * tiene estado (evergreen sin destino, evergreen apuntado) el color va en un
 * StateDot adelante y NUNCA en el fondo ni en el texto — misma regla que
 * `StatusPill`, para que una fila de chips no termine siendo un semáforo.
 *
 * Vive acá y no en `components/kg` porque hoy lo usa un solo header; si otro
 * módulo lo necesita, se promueve a primitiva.
 */
function Chip({
  children,
  tone,
  title,
}: {
  readonly children: ReactNode;
  readonly tone?: KgTone;
  readonly title?: string;
}) {
  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 10px",
    borderRadius: "var(--kg-r-full)",
    background: "var(--kg-surface-2-solid)",
    border: "1px solid var(--kg-border-subtle)",
    color: "var(--kg-text-2)",
    fontSize: 12,
    fontWeight: 500,
    whiteSpace: "nowrap",
  };
  return (
    <span style={style} title={title}>
      <StateDot tone={tone ?? null} size={4} />
      {children}
    </span>
  );
}
