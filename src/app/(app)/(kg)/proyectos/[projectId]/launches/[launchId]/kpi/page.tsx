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
import { ContextBar, type ContextBarStat } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import {
  ErrorBanner,
  panelActionSecondaryBtn,
} from "@/components/kg/form-primitives";
import { IconLaunch, IconTable } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { fmtMoney, fmtMultiplier, fmtNumber } from "@/lib/format";
import { calculateLaunchKPIs } from "@/lib/kpis";
import { aggregateCommunityMetrics } from "@/lib/launch-community/aggregate";
import { listSendflowDailyForLaunch } from "@/lib/launch-community/daily";
import { listCommunityMetricsForLaunch } from "@/lib/launch-community/list";
import { aggregateMergedDaily } from "@/lib/launch-daily/aggregate";
import { listAdsForLaunch, listDailyForLaunch } from "@/lib/launch-daily/list";
import { mergeDailyData } from "@/lib/launch-daily/merge";
import { aggregateKanbanSales } from "@/lib/launch-sales/aggregate";
import { listLaunchSalesData } from "@/lib/launch-sales/list";
import { getLaunch } from "@/lib/launches/get";
import { listMessagesDailyForLaunch } from "@/lib/launch-messages/list";
import { listRecentRuns } from "@/lib/integrations/runs";
import { requireSessionProfile, userCanEditLaunchesIn } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import {
  buildSalesFxContext,
  loadProjectFxRates,
  resolveLaunchFallbackRate,
} from "@/lib/money";
import { listPaymentMethods } from "@/lib/payment-methods/list";
import { listBanks } from "@/lib/banks/list";

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

  const supabase = await createClient();
  const [
    profile,
    launch,
    canEditLaunchValue,
    daily,
    ads,
    launchSalesData,
    community,
    sendflowDaily,
    messagesDaily,
    recentRuns,
    fxMap,
    paymentMethods,
    banks,
  ] = await Promise.all([
    requireSessionProfile(),
    getLaunch(launchId),
    userCanEditLaunchesIn(projectId),
    listDailyForLaunch(launchId),
    listAdsForLaunch(launchId),
    listLaunchSalesData(projectId, launchId),
    listCommunityMetricsForLaunch(launchId),
    listSendflowDailyForLaunch(launchId),
    listMessagesDailyForLaunch(launchId),
    listRecentRuns(launchId, 20),
    loadProjectFxRates(supabase, projectId),
    listPaymentMethods(),
    listBanks(),
  ]);

  const hideRevenueKpis = profile.role === "operador";

  if (!launch || launch.project_id !== projectId) notFound();

  const mergedDaily = mergeDailyData(daily, ads);
  const adsAggregate = aggregateMergedDaily(mergedDaily);
  const communityAggregate = aggregateCommunityMetrics(community);

  // GHL leads capturados en la ventana del launch. Vienen del sync GHL en
  // launch_daily_ads con provider='ghl'. mergeDailyData los IGNORA (solo mira
  // meta/google/tiktok), así que este total NO se suma al de leads Meta.
  // La UI los renderea aparte: KPI card dedicada + curva propia en la gráfica.
  const ghlLeadsByDate = new Map<string, number>();
  let ghlContactsTotal = 0;
  for (const r of ads) {
    if (r.provider !== "ghl") continue;
    ghlLeadsByDate.set(r.date, (ghlLeadsByDate.get(r.date) ?? 0) + r.leads);
    ghlContactsTotal += r.leads;
  }

  // Si hay datos de pipeline en ghl_pipeline_lead_counts, ese es el conteo
  // real de leads y reemplaza al de contacts. Si no hay datos de pipeline
  // (pipeline no configurada o sync todavía no corrió con pipeline), usamos
  // el count de contacts como fallback.
  const pipelineCountsRes = await supabase
    .from("ghl_pipeline_lead_counts" as never)
    .select("lead_count")
    .eq("launch_id", launchId);
  const ghlPipelineTotal = ((pipelineCountsRes.data ?? []) as Array<{ lead_count: number }>)
    .reduce((sum, r) => sum + r.lead_count, 0);

  const ghlNewLeadsTotal = ghlPipelineTotal > 0 ? ghlPipelineTotal : ghlContactsTotal;

  // Aggregate tradicional para counts (salesCount, paymentsCount, hasData)
  const kanbanSalesAggregate = aggregateKanbanSales(
    launchSalesData.sales as never,
    launchSalesData.payments as never,
    launchSalesData.leads as never,
    launchId,
  );

  // Revenue convertido por moneda: filtramos ventas/cobros a "cerrado"
  // con atribución a este launch (sale.launch_id = launchId)
  const launchRow = launch as unknown as {
    ars_per_usd?: number | null;
    ads_currency?: string;
    date_start?: string | null;
    date_end?: string | null;
  };

  // Tasa efectiva del launch: propia (`ars_per_usd`) o mensual (mes anchor
  // del launch en `project_fx_rates`). Usada para valores agregados sin
  // fecha propia — revenue manual e inversión de ads cuando ads_currency=ARS.
  // Los pagos individuales usan `SalesFxContext` (tasa mensual por `paid_at`).
  const revenueRate = resolveLaunchFallbackRate(launchRow, fxMap);
  const arsPerUsd = launchRow.ars_per_usd ?? null;

  const leadById = new Map(launchSalesData.leads.map((l) => [l.id, l]));
  const cerradoSales = launchSalesData.sales.filter((s) => {
    if ((s as unknown as { launch_id?: string | null }).launch_id !== launchId)
      return false;
    const lead = leadById.get(s.lead_id);
    return (lead as unknown as { status?: string })?.status === "cerrado";
  });
  const cerradoSaleIds = new Set(cerradoSales.map((s) => s.id));
  const cerradoPayments = launchSalesData.payments.filter((p) =>
    cerradoSaleIds.has(p.sale_id),
  );

  // Contexto FX del launch: convierte sale.total_amount con la tasa del
  // launch; payments con launch → mensual del mes de paid_at. Cobros/ventas
  // sin tasa disponible se omiten del total (retornan null) en lugar de
  // sumar en moneda mixta.
  const fxCtx = buildSalesFxContext({
    banks: banks as unknown as Array<{ id: string; currency: "ARS" | "USD" }>,
    paymentMethods: paymentMethods as unknown as Array<{
      id: string;
      bank_id: string | null;
      currency: "ARS" | "USD" | null;
    }>,
    leads: launchSalesData.leads.map((l) => ({
      id: l.id,
      launch_id: (l as unknown as { launch_id?: string | null }).launch_id ?? null,
    })),
    launches: [
      {
        id: launch.id,
        ars_per_usd: arsPerUsd,
        date_start: launchRow.date_start ?? null,
        date_end: launchRow.date_end ?? null,
      },
    ],
    sales: launchSalesData.sales,
    fxMap,
  });

  // Cuando hay al menos una venta cerrada, inicializamos en 0 en vez de
  // null: si ningún cobro convierte (rate faltante), preferimos mostrar 0
  // + warning a que kpis.ts caiga al fallback raw del aggregate y muestre
  // el número en pesos mezclado con ads en dólares. `null` solo cuando NO
  // hay ventas cerradas — ahí el aggregate manda igual (todo 0).
  let kanbanPledgedUsd: number | null = cerradoSales.length > 0 ? 0 : null;
  let missingSaleRate = 0;
  for (const s of cerradoSales) {
    const v = fxCtx.saleToUsd(s);
    if (v !== null) kanbanPledgedUsd = (kanbanPledgedUsd ?? 0) + v;
    else missingSaleRate++;
  }
  let kanbanCollectedUsd: number | null = cerradoPayments.length > 0 ? 0 : null;
  let missingPaymentRate = 0;
  for (const p of cerradoPayments) {
    const v = fxCtx.paymentToUsd(p);
    if (v !== null) kanbanCollectedUsd = (kanbanCollectedUsd ?? 0) + v;
    else missingPaymentRate++;
  }
  const missingFxNote =
    missingSaleRate + missingPaymentRate > 0
      ? `Faltan tasas FX para ${missingSaleRate} venta${missingSaleRate === 1 ? "" : "s"} y ${missingPaymentRate} cobro${missingPaymentRate === 1 ? "" : "s"}. Cargá la tasa mensual en Financiero → Tasas.`
      : null;

  // Tasa para ads (Meta/Google/TikTok): solo si el launch declaró que la
  // cuenta reporta en ARS. Si declara USD, no se convierte — Meta ya la trae
  // en dólares.
  const adsRatePerUsd =
    launchRow.ads_currency === "ARS" && revenueRate ? revenueRate : null;

  const kpi = calculateLaunchKPIs(launch, {
    adsAggregate,
    kanbanSalesAggregate,
    communityAggregate,
    adsRatePerUsd,
    kanbanPledgedUsd,
    kanbanCollectedUsd,
    revenueRatePerUsd: revenueRate,
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
    ghlLeadsByDate,
  });
  const overlayPartialNote = buildOverlayPartialNote(recentRuns);

  // Resumen para la barra flotante. El operador no ve dinero facturado (misma
  // regla que `KpiGrid`), así que en ese rol el cuarto stat cae en los leads
  // de GHL — ejecución pura, que sí puede mirar.
  const contextStats: ContextBarStat[] = [
    { l: "Leads totales", v: fmtNumber(kpi.totalLeads) },
    { l: "Inversión", v: fmtMoney(kpi.totalInvestment) },
    { l: "Ventas", v: fmtNumber(kpi.ventas) },
    hideRevenueKpis
      ? { l: "Leads GHL", v: fmtNumber(ghlNewLeadsTotal) }
      : {
          l: "ROAS real",
          v: fmtMultiplier(kpi.roasReal),
          // 1x es el break-even: por debajo, lo cobrado no cubre la inversión.
          // Sin inversión cargada el ratio da 0 y pintarlo sería ruido.
          c:
            kpi.totalInvestment > 0
              ? kpi.roasReal >= 1
                ? "#00D084"
                : "#DC143C"
              : undefined,
        },
  ];

  return (
    <div className="flex flex-col gap-5">
      <ContextBar
        icon={<IconLaunch size={16} />}
        title="KPI"
        stats={contextStats}
      />

      <KpiGrid
        kpi={kpi}
        launchArsPerUsd={arsPerUsd}
        kpisInUsd={revenueRate !== null}
        hideRevenueKpis={hideRevenueKpis}
        ghlNewLeads={ghlNewLeadsTotal}
      />

      {/*
        El aviso FX no es un error: los KPIs se muestran igual, solo que
        incompletos. `tone="warning"` es exactamente esa distinción — y
        además baja el `role` a "status" para que el lector de pantalla no
        interrumpa por algo que ya estaba en la página al cargar. Antes era
        un div a mano con los tokens viejos `border-warning/40 bg-warning/10`.
      */}
      {missingFxNote && <ErrorBanner message={missingFxNote} tone="warning" />}

      <CommunityKpiBlock kpi={kpi} />

      {/*
        "Datos diarios" era un <section> con <header> propio (h2 `text-fg` +
        p `text-fg-subtle`) y los botones sueltos al lado. Ahora es el molde
        canónico del DS: `Panel` con `actions` en la cabecera. La tabla va
        `pad={false}` porque trae su propio padding de celdas.
      */}
      <Panel
        pad={false}
        title={
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span>Datos diarios</span>
            {/* kg-t6 (12px/500) y no kg-t7: t7 va en VERSALITAS y sirve para
                etiquetas cortas, no para una frase. */}
            <span className="kg-t6" style={{ color: "var(--kg-text-3)" }}>
              Leads por canal por día. Alimenta el gráfico de abajo.
            </span>
          </span>
        }
        actions={
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              flexShrink: 0,
            }}
          >
            {canEditLaunchValue && mergedDaily.length > 0 && (
              // `hidden md:contents`: mismo recorte que el "Exportar Excel"
              // de `financiero/gastos`. En 390px la cabecera del Panel no
              // hace wrap, y dos botones + el título de dos líneas la
              // desbordan; descargar un CSV es acción de escritorio.
              <span className="hidden md:contents">
                {/*
                  `panelActionSecondaryBtn` y no `secondaryBtn`: es la
                  variante de padding chico (6/14) que form-primitives
                  documenta para la cabecera de un Panel — el mismo botón
                  que usa gastos. `secondaryBtn` (8/16) haría el header más
                  alto que el del resto de los paneles.
                */}
                <a
                  href={`/api/proyectos/${projectId}/launches/${launchId}/daily/export?format=csv`}
                  className="kg-focus"
                  title="Descargar los datos diarios en CSV"
                  style={{
                    ...panelActionSecondaryBtn,
                    display: "inline-flex",
                    alignItems: "center",
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                  }}
                >
                  ⬇ Exportar CSV
                </a>
              </span>
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
              <span className="kg-t6" style={{ color: "var(--kg-text-3)" }}>
                Cerrado — no se cargan más datos
              </span>
            )}
          </div>
        }
      >
        {daily.length === 0 && mergedDaily.length === 0 ? (
          // El vacío se trata como onboarding, no como "sin datos": el
          // `EmptyState` dice qué hacer para llenarlo, y el texto cambia
          // según si esta persona puede cargarlos. Antes era un div con
          // `border-dashed border-border` y todo el texto en una sola línea.
          <EmptyState
            icon={<IconTable size={18} />}
            title="Sin datos diarios cargados"
            hint={
              canEditLaunchValue
                ? "Agregá uno a mano o configurá la integración para que la API los traiga sola."
                : "El admin u operador del proyecto los va a cargar."
            }
          />
        ) : (
          <DailyTable
            rows={daily}
            canEdit={canEditLaunchValue && !isClosed}
            projectId={projectId}
            launchId={launchId}
          />
        )}
      </Panel>

      {/*
        El chart salió del <section> de "Datos diarios" y pasó a Panel propio:
        son dos lecturas distintas (el detalle fila por fila vs. la forma de
        la curva) y compartir caja las hacía competir. El div contenedor era
        `rounded-md border border-border bg-surface/40 p-4` — tokens viejos.
        Sin `fillHeight`: el chart tiene alto propio y la page NO es un flex
        container de altura completa (ver el wrapper raíz).
      */}
      {(daily.length > 0 || mergedDaily.length > 0) && (
        <Panel title="Leads por día">
          <DailyChart rows={chartRows} overlayPartialNote={overlayPartialNote} />
        </Panel>
      )}

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
  readonly ghlLeadsByDate: ReadonlyMap<string, number>;
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
      ghl_new_leads: 0,
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
      ghl_new_leads: 0,
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
  for (const [date, count] of args.ghlLeadsByDate) {
    const row = ensure(date);
    row.ghl_new_leads = count;
  }
  return Array.from(byDate.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}

/**
 * Construye una nota de partial para el chart si el último run de SendFlow
 * no terminó success. El brief obliga a surface esto en
 * UI — el operador necesita saber que los totales pueden estar truncados.
 */
function buildOverlayPartialNote(
  runs: ReadonlyArray<{ provider: string; status: string | null; errorDetail: unknown }>,
): string | null {
  const lastSendflow = runs.find((r) => r.provider === "sendflow");

  const notes: string[] = [];
  if (lastSendflow && lastSendflow.status === "partial") {
    const msg = readErrorDetailMessage(lastSendflow.errorDetail);
    notes.push(`SendFlow: ${msg ?? "sync parcial"}`);
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
