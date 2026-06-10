import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AiHistory } from "@/components/dashboard/launches/ai/ai-history";
import { AiSummaryTrigger } from "@/components/dashboard/launches/ai/ai-summary-trigger";
import { fetchRunAuthors, listAiRunsForLaunch } from "@/lib/ai/list-runs";
import { getLaunch } from "@/lib/launches/get";
import { userCanEditLaunchesIn } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "IA · Lanzamiento" };

export default async function LaunchAiPage({
  params,
}: {
  readonly params: Promise<{ projectId: string; launchId: string }>;
}) {
  const { projectId, launchId } = await params;

  const [launch, canRun, runs] = await Promise.all([
    getLaunch(launchId),
    userCanEditLaunchesIn(projectId),
    listAiRunsForLaunch(launchId, 20),
  ]);

  if (!launch || launch.project_id !== projectId) notFound();

  const authorById = await fetchRunAuthors(runs);

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <header>
          <h2 className="text-base font-semibold text-fg">Análisis IA</h2>
          <p className="text-xs text-fg-subtle">
            Generá un resumen ejecutivo a partir de los KPIs y los datos
            diarios. Cada corrida queda registrada en el historial.
          </p>
        </header>
      </section>

      <AiSummaryTrigger
        projectId={projectId}
        launchId={launchId}
        canRun={canRun}
        hasHistory={runs.length > 0}
      />

      <section className="space-y-3">
        <header className="flex items-baseline justify-between gap-4">
          <h3 className="text-sm font-semibold text-fg">Historial</h3>
          <span className="text-xs text-fg-subtle">
            {runs.length} {runs.length === 1 ? "corrida" : "corridas"}
          </span>
        </header>
        <AiHistory runs={runs} authorById={authorById} />
      </section>
    </div>
  );
}
