import { NextResponse } from "next/server";

import { buildDailyCsv } from "@/lib/launch-daily/export-csv";
import {
  listAdsForLaunch,
  listDailyForLaunch,
} from "@/lib/launch-daily/list";
import { mergeDailyData } from "@/lib/launch-daily/merge";
import { getLaunch } from "@/lib/launches/get";
import { requireCanEditLaunchesIn } from "@/lib/supabase/auth";

/**
 * GET /api/proyectos/[projectId]/launches/[launchId]/daily/export?format=csv
 *
 * Devuelve los datos diarios mergeados (manual + API) del launch en CSV.
 * Hoy CSV es el único formato soportado — el query param queda como hint para
 * sumar xlsx en el futuro sin romper los enlaces existentes.
 *
 * Verificaciones:
 *  1. `requireCanEditLaunchesIn(projectId)`: admin / operador / superadmin.
 *     Cliente y coordinador quedan fuera (consistente con el resto del CRM).
 *  2. El launch existe y `launch.project_id` matchea el `projectId` del path.
 *     Defensa contra URL tampering — el gate de permisos es sobre projectId,
 *     necesitamos confirmar que el launch realmente pertenezca a ese proyecto.
 *
 * El filename usa un slug del nombre del launch para que el archivo bajado
 * sea reconocible cuando se exportan varios launches.
 */
export async function GET(
  request: Request,
  {
    params,
  }: { params: Promise<{ projectId: string; launchId: string }> },
) {
  const { projectId, launchId } = await params;
  await requireCanEditLaunchesIn(projectId);

  const launch = await getLaunch(launchId);
  if (!launch || launch.project_id !== projectId) {
    return NextResponse.json({ error: "Lanzamiento no encontrado" }, { status: 404 });
  }

  const [daily, ads] = await Promise.all([
    listDailyForLaunch(launchId),
    listAdsForLaunch(launchId),
  ]);
  const merged = mergeDailyData(daily, ads);

  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "csv";
  if (format !== "csv") {
    return NextResponse.json(
      { error: `Formato no soportado: ${format}` },
      { status: 400 },
    );
  }

  const csv = buildDailyCsv(merged);
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = slugifyForFilename(launch.name);
  const filename = `daily-${slug}-${stamp}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Slugifica el nombre del launch para meterlo en el filename: minúsculas,
 * sin acentos, alfanum + guiones, máx 40 chars. Si queda vacío usa
 * `launch`.
 */
function slugifyForFilename(name: string): string {
  const normalized = name
    .normalize("NFD")
    // Combining diacritical marks range (U+0300..U+036F) — saca acentos
    // después de descomponer en NFD.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return normalized || "launch";
}
