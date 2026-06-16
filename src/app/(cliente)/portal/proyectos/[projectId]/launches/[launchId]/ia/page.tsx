import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ClientAiTrigger } from "@/components/client-portal/client-ai-trigger";
import { getLaunch } from "@/lib/launches/get";

export const metadata: Metadata = { title: "IA · Portal" };

/**
 * Análisis IA del lanzamiento para el cliente. Vista mínima: contexto + botón
 * para generar. No mostramos historial cross-team en esta primera iteración
 * (el cliente no debe ver runs disparados por el equipo); cuando se decida la
 * UX del historial propio, agregar query `ai_runs WHERE user_id = auth.uid()`.
 */
export default async function ClientLaunchAiPage({
  params,
}: {
  readonly params: Promise<{ projectId: string; launchId: string }>;
}) {
  const { projectId, launchId } = await params;
  const launch = await getLaunch(launchId);
  if (!launch || launch.project_id !== projectId) notFound();

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Análisis IA</h1>
        <p className="text-xs text-fg-subtle">
          Resumen ejecutivo del lanzamiento <span className="text-fg">{launch.name}</span>{" "}
          generado por IA a partir de tus métricas.
        </p>
      </header>

      <ClientAiTrigger projectId={projectId} launchId={launchId} />
    </div>
  );
}
