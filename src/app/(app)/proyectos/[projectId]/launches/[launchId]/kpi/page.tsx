import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CommunityKpiBlock } from "@/components/dashboard/launches/community-kpi-block";
import {
  DailyChart,
  type DailyChartRow,
} from "@/components/dashboard/launches/daily/daily-chart";
import { DailyFormModal } from "@/components/dashboard/launches/daily/daily-form-modal";
import { DailyTable } from "@/components/dashboard/launches/daily/daily-table";
import { RealtimeProbe } from "@/components/dashboard/launches/integrations/realtime-probe";
import { KpiGrid } from "@/components/dashboard/launches/kpi-grid";
import { calculateLaunchKPIs } from "@/lib/kpis";
import { aggregateCommunityMetrics } from "@/lib/launch-community/aggregate";
import { listSendflowDailyForLaunch } from "@/lib/launch-community/daily";
import { listCommunityMetricsForLaunch } from "@/lib/launch-community/list";
import { aggregateMergedDaily } from "@/lib/launch-daily/aggregate";
import { listAdsForLaunch, listDailyForLaunch } from "@/lib/launch-daily/list";
import { mergeDailyData } from "@/lib/launch-daily/merge";
import { getKanbanSalesAggregateForLaunch } from "@/lib/launch-sales/list";
import { getLaunch } from "@/lib/launches/get";
import { listMessagesDailyForLaunch } from "@/lib/launch-messages/list";
import { listRecentRuns } from "@/lib/integrations/runs";
import { userCanEditLaunchesIn } from "@/lib/supabase/auth";

import { createDailyEntry } from "../daily-actions";

export const metadata: Metadata = { title: "KPI · Lanzamiento" };

/**
 * Tab principal: KPIs, carga manual de datos diarios y gráfico merged.
 * El header + tabs los pone el layout padre — esta page solo renderiza el
 * contenido del tab activo.
 */
export default async function LaunchKpiPage({
  params,
}: {
  readonly params: Promise<{ projectId: string; launchId: string }>;
}) {
  const { projectId, launchId } = await params;

  const [
    launch,
    canEditLaunchValue,
    daily,
    ads,
    kanbanSalesAggregate,
    community,
    sendflowDaily,
    messagesDaily,
    recentRuns,
  ] = await Promise.all([
    getLaunch(launchId),
    userCanEditLaunchesIn(projectId),
    listDailyForLaunch(launchId),
    listAdsForLaunch(launchId),
    getKanbanSalesAggregateForLaunch(projectId, launchId),
    listCommunityMetricsForLaunch(launchId),
    listSendflowDailyForLaunch(launchId),
    listMessagesDailyForLaunch(launchId),
    listRecentRuns(launchId, 20),
  ]);

  if (!launch || launch.project_id !== projectId) notFound();

  const mergedDaily = mergeDailyData(daily, ads);
  const adsAggregate = aggregateMergedDaily(mergedDaily);
  const communityAggregate = aggregateCommunityMetrics(community);
  const kpi = calculateLaunchKPIs(launch, {
    adsAggregate,
    kanbanSalesAggregate,
    communityAggregate,
  });
  const isClosed = launch.closed_at !== null;
  const addDailyAction = createDailyEntry.bind(null, projectId, launchId);

  // Overlay del chart (Fase B): merge de canales + SendFlow + GHL messages
  // por fecha. Series con suma=0 en todo el rango quedan ocultas dentro del
  // chart (el filtro lo hace el componente).
  const chartRows = buildOverlayRows({
    merged: mergedDaily,
    sendflow: sendflowDaily.rows,
    messages: messagesDaily,
  });
  const overlayPartialNote = buildOverlayPartialNote(recentRuns);

  return (
    <div className="space-y-10">
      <KpiGrid kpi={kpi} />

      <CommunityKpiBlock kpi={kpi} />

      <section className="space-y-4">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-fg">Datos diarios</h2>
            <p className="text-xs text-fg-subtle">
              Leads por canal por día. Alimenta el gráfico de abajo.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canEditLaunchValue && mergedDaily.length > 0 && (
              <a
                href={`/api/proyectos/${projectId}/launches/${launchId}/daily/export?format=csv`}
                className="inline-flex items-center rounded-md border border-border bg-surface px-3 py-2 text-sm font-semibold text-fg hover:bg-bg-elevated"
              >
                ⬇ Exportar CSV
              </a>
            )}
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
          </div>
        </header>

        {daily.length === 0 && mergedDaily.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-surface/40 p-8 text-center text-sm text-fg-muted">
            Sin datos diarios cargados.
            {canEditLaunchValue
              ? " Agregá uno a mano o configurá la integración para que la API los traiga sola."
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
              <DailyChart
                rows={chartRows}
                overlayPartialNote={overlayPartialNote}
              />
            </div>
          </>
        )}
      </section>

      {/* Probe de realtime para que el chart/tabla refresh cuando el sync
          escribe nuevas filas de ads. Vivía en el page monolítico; lo dejamos
          en este tab que es donde el efecto es visible. */}
      <RealtimeProbe launchId={launchId} />
    </div>
  );
}

/**
 * Mergea las 3 fuentes (canales merged, SendFlow daily, GHL messages daily)
 * en filas para el chart. Las fechas que solo aparecen en una fuente entran
 * con ceros en las otras — necesario para que la curva esté completa y
 * `connectNulls` no atraviese huecos artificiales.
 */
function buildOverlayRows(args: {
  readonly merged: ReadonlyArray<
    {
      readonly date: string;
      readonly meta_ads: number;
      readonly google_ads: number;
      readonly tiktok_ads: number;
      readonly organico: number;
      readonly whatsapp: number;
      readonly referidos: number;
      readonly otro: number;
    }
  >;
  readonly sendflow: ReadonlyArray<{ readonly date: string; readonly entered: number }>;
  readonly messages: ReadonlyArray<{
    readonly date: string;
    readonly inboundCount: number;
  }>;
}): DailyChartRow[] {
  const byDate = new Map<string, DailyChartRow>();
  for (const r of args.merged) {
    byDate.set(r.date, {
      date: r.date,
      meta_ads: r.meta_ads,
      google_ads: r.google_ads,
      tiktok_ads: r.tiktok_ads,
      organico: r.organico,
      whatsapp: r.whatsapp,
      referidos: r.referidos,
      otro: r.otro,
      sendflow_add: 0,
      ghl_inbound: 0,
    });
  }
  const ensure = (date: string): DailyChartRow => {
    const existing = byDate.get(date);
    if (existing) return existing;
    const fresh: DailyChartRow = {
      date,
      meta_ads: 0,
      google_ads: 0,
      tiktok_ads: 0,
      organico: 0,
      whatsapp: 0,
      referidos: 0,
      otro: 0,
      sendflow_add: 0,
      ghl_inbound: 0,
    };
    byDate.set(date, fresh);
    return fresh;
  };
  for (const s of args.sendflow) {
    const row = ensure(s.date);
    row.sendflow_add = s.entered;
  }
  for (const m of args.messages) {
    const row = ensure(m.date);
    row.ghl_inbound = m.inboundCount;
  }
  return Array.from(byDate.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}

/**
 * Construye una nota de partial para el chart si el último run de SendFlow
 * o de GHL Messages no terminó success. El brief obliga a surface esto en
 * UI — el operador necesita saber que los totales pueden estar truncados.
 */
function buildOverlayPartialNote(
  runs: ReadonlyArray<{ provider: string; status: string | null; errorDetail: unknown }>,
): string | null {
  const lastSendflow = runs.find((r) => r.provider === "sendflow");
  const lastMessages = runs.find((r) => r.provider === "ghl_messages");

  const notes: string[] = [];
  if (lastSendflow && lastSendflow.status === "partial") {
    const msg = readErrorDetailMessage(lastSendflow.errorDetail);
    notes.push(`SendFlow: ${msg ?? "sync parcial"}`);
  }
  if (lastMessages && lastMessages.status === "partial") {
    const msg = readErrorDetailMessage(lastMessages.errorDetail);
    notes.push(`WhatsApp/SMS: ${msg ?? "sync parcial"}`);
  }
  return notes.length === 0 ? null : notes.join(" · ");
}

function readErrorDetailMessage(detail: unknown): string | null {
  if (detail === null || typeof detail !== "object") return null;
  const rec = detail as Record<string, unknown>;
  if (typeof rec.message === "string" && rec.message.length > 0) {
    return rec.message;
  }
  return null;
}
