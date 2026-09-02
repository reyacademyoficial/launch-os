import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LaunchIntegrationsSection } from "@/components/dashboard/launches/integrations/launch-integrations-section";
import { ContextBar } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import { IconLaunch } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { fmtLaunchWindow, fmtNumber } from "@/lib/format";
import { getLaunch } from "@/lib/launches/get";
import { userCanEditLaunchesIn } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "Integraciones · Lanzamiento" };

// El Server Action `triggerSync` se dispara desde esta ruta (formulario en el
// botón Sincronizar). Para syncs pesados de GHL (locations con miles de
// contactos+conversaciones) el sync puede cortarse a mitad y dejar la fila en
// `running`; el watchdog (0019) desbloquea el botón. 300 es el techo del plan
// hobby — si migramos a Pro se puede subir.
export const maxDuration = 300;

export default async function LaunchIntegrationsPage({
  params,
}: {
  readonly params: Promise<{ projectId: string; launchId: string }>;
}) {
  const { projectId, launchId } = await params;

  const [launch, canEditLaunchValue] = await Promise.all([
    getLaunch(launchId),
    userCanEditLaunchesIn(projectId),
  ]);

  if (!launch || launch.project_id !== projectId) notFound();

  const isClosed = launch.closed_at !== null;

  // Cliente y coordinador no editan integraciones — la sección no tiene sentido
  // de mostrar. Le damos un mensaje minimal en vez de un layout vacío.
  if (!canEditLaunchValue) {
    // El gate va envuelto en Panel para que el vacío tenga el mismo chasis que
    // el resto de la pestaña — un EmptyState suelto flota sin superficie y se
    // lee como "la página no cargó" en vez de "no tenés permisos".
    return (
      <div className="flex flex-col gap-5">
        <Panel pad={false}>
          <EmptyState
            icon={<IconLaunch size={18} />}
            title="Sin permisos"
            hint="No podés ver ni editar las integraciones de este lanzamiento. Pedile acceso a un admin u operador del proyecto."
          />
        </Panel>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/*
        El estado por provider lo resuelve la sección (lee config + secrets con
        service-role). Acá mostramos lo que condiciona a TODOS los syncs: qué
        plataformas declaró el launch, qué ventana se pide a las APIs y si el
        launch está cerrado (con el launch cerrado el sync queda bloqueado).
      */}
      <ContextBar
        icon={<IconLaunch size={16} />}
        title="Integraciones"
        stats={[
          { l: "Plataformas", v: fmtNumber(launch.platforms.length) },
          {
            l: "Ventana de sync",
            v: fmtLaunchWindow(launch.date_start, launch.date_end),
          },
          {
            l: "Sync",
            v: isClosed ? "Bloqueado" : "Habilitado",
            c: isClosed ? "#FFB800" : undefined,
          },
        ]}
      />

      <LaunchIntegrationsSection
        projectId={projectId}
        launchId={launchId}
        isClosed={isClosed}
      />
    </div>
  );
}
