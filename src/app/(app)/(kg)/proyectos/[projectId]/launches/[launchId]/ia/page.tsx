import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AiHistory } from "@/components/dashboard/launches/ai/ai-history";
import { AiSummaryTrigger } from "@/components/dashboard/launches/ai/ai-summary-trigger";
import { ContextBar } from "@/components/kg/context-bar";
import { IconLaunch } from "@/components/kg/icons";
import { SectionHeader } from "@/components/kg/section-header";
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

      {/*
        Los dos `<header>` con `<h2>`/`<h3>` propios pasaron a `SectionHeader`
        — que ya trae ícono + título + stats inline y NO es sticky, que es lo
        que corresponde acá: el sticky de la pestaña es el ContextBar.

        La bajada de "Análisis IA" se borró: decía lo mismo que el copy que ya
        vive dentro del Panel del trigger, un renglón más abajo.

        El bloque de generación y el historial arman sus propios `Panel`s
        (AiSummaryTrigger / AiHistory), así que esta page sólo compone.
      */}
      <SectionHeader icon={<IconLaunch size={16} />} title="Análisis IA" />

      <AiSummaryTrigger
        projectId={projectId}
        launchId={launchId}
        canRun={canRun}
        hasHistory={runs.length > 0}
      />

      <SectionHeader
        icon={<IconLaunch size={16} />}
        title="Historial"
        stats={[
          {
            l: runs.length === 1 ? "Corrida" : "Corridas",
            v: fmtNumber(runs.length),
          },
        ]}
      />

      <AiHistory runs={runs} authorById={authorById} />
    </div>
  );
}
