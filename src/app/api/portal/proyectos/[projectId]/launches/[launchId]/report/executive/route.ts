import { NextResponse } from "next/server";

import { calculateLaunchKPIs } from "@/lib/kpis";
import { aggregateMergedDaily } from "@/lib/launch-daily/aggregate";
import {
  listAdsForLaunch,
  listDailyForLaunch,
} from "@/lib/launch-daily/list";
import { mergeDailyData } from "@/lib/launch-daily/merge";
import {
  aggregateOpportunities,
  EMPTY_SALES_AGGREGATE,
} from "@/lib/launch-opportunities/aggregate";
import { listOpportunitiesForLaunch } from "@/lib/launch-opportunities/list";
import { tryComputeLaunchCalendar } from "@/lib/launches/calendar";
import { getLaunch } from "@/lib/launches/get";
import {
  renderExecutiveLaunchPdf,
  type ExecutiveLaunchInput,
} from "@/lib/reports/executive-launch-pdf";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/supabase/auth";

/**
 * GET /api/portal/proyectos/[projectId]/launches/[launchId]/report/executive
 *
 * PDF resumen ejecutivo desde el portal del cliente. Reusa
 * `renderExecutiveLaunchPdf` — mismo template que descarga el equipo. La diff
 * con el endpoint del equipo es el gate de rol (`requireRole('cliente')` en
 * vez de `requireCanEditLaunchesIn`) y el path (`/api/portal/…`).
 *
 * Explícitamente NO se expone el endpoint paralelo de comisiones:
 * `/api/portal/.../report/commissions` no existe — la frontera de contenido
 * la sostiene la ausencia de la ruta + el grant ausente a
 * commission_rules / payment_modalities en DB (migración 0023).
 */
export async function GET(
  _request: Request,
  {
    params,
  }: { params: Promise<{ projectId: string; launchId: string }> },
) {
  const { projectId, launchId } = await params;
  await requireRole("cliente");

  const launch = await getLaunch(launchId);
  if (!launch || launch.project_id !== projectId) {
    return NextResponse.json({ error: "Lanzamiento no encontrado" }, { status: 404 });
  }

  const supabase = await createClient();
  const [projectRes, daily, ads, opportunities] = await Promise.all([
    supabase
      .from("projects")
      .select("name, business_name")
      .eq("id", projectId)
      .maybeSingle(),
    listDailyForLaunch(launchId),
    listAdsForLaunch(launchId),
    listOpportunitiesForLaunch(launchId),
  ]);

  const project = projectRes.data as
    | { name: string; business_name: string | null }
    | null;
  if (!project) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }

  const mergedDaily = mergeDailyData(daily, ads);
  const adsAggregate = aggregateMergedDaily(mergedDaily);
  const salesAggregate =
    launch.date_start && launch.date_end
      ? aggregateOpportunities(opportunities, {
          date_start: launch.date_start,
          date_end: launch.date_end,
        })
      : EMPTY_SALES_AGGREGATE;
  const kpi = calculateLaunchKPIs(launch, { adsAggregate, salesAggregate });

  const calendar = tryComputeLaunchCalendar({
    launchDate: launch.launch_date ?? undefined,
    durCaptacion: launch.dur_captacion,
    durCalentamiento: launch.dur_calentamiento,
    durCompra: launch.dur_compra,
    durCierre: launch.dur_cierre,
  });

  const input: ExecutiveLaunchInput = {
    projectName: project.name,
    projectBusinessName: project.business_name,
    launchName: launch.name,
    launchType: launch.type,
    launchStatus: launch.status,
    platforms: launch.platforms ?? [],
    dateStart: launch.date_start,
    dateEnd: launch.date_end,
    closedAt: launch.closed_at,
    calendar,
    kpi,
    mergedDaily,
  };

  let buffer: Buffer;
  try {
    buffer = await renderExecutiveLaunchPdf(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : "render_failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const slug = slugifyForFilename(launch.name);
  const filename = `resumen-ejecutivo-${slug}-${stamp}.pdf`;

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

function slugifyForFilename(name: string): string {
  const normalized = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return normalized || "launch";
}
