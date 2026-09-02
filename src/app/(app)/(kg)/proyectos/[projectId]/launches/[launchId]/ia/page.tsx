import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AiHistory } from "@/components/dashboard/launches/ai/ai-history";
import { AiSummaryTrigger } from "@/components/dashboard/launches/ai/ai-summary-trigger";
import { ContextBar } from "@/components/kg/context-bar";
import { IconLaunch } from "@/components/kg/icons";
import { fetchRunAuthors, listAiRunsForLaunch } from "@/lib/ai/list-runs";
import { fmtDate, fmtNumber } from "@/lib/format";
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

  // `runs` viene capado a las últimas 20 corridas — los stats describen esa
  // ventana, no el historial completo.
  const failedRuns = runs.filter((r) => r.status === "error").length;

  return (
    <div className="flex flex-col gap-5">
      <ContextBar
        icon={<IconLaunch size={16} />}
        title="IA"
        stats={[
          { l: "Últimas corridas", v: fmtNumber(runs.length) },
          {
            l: "Con error",
            v: fmtNumber(failedRuns),
            // Una corrida fallida es plata gastada sin output — hay que mirarla.
            c: failedRuns > 0 ? "#DC143C" : undefined,
          },
          { l: "Última corrida", v: fmtDate(runs[0]?.created_at ?? null) },
          { l: "Autores", v: fmtNumber(authorById.size) },
        ]}
      />

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
    </div>
  );
}
