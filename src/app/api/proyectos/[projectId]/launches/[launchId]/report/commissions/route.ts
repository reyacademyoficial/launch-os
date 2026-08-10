import { NextResponse } from "next/server";

import {
  listCommissionRules,
  listPaymentModalities,
} from "@/lib/commissions/list";
import { getLaunch } from "@/lib/launches/get";
import {
  renderCommissionsLaunchPdf,
  type CommissionsLaunchInput,
} from "@/lib/reports/commissions-launch-pdf";
import { listSalesByLaunch } from "@/lib/sales/list-by-launch";
import { createClient } from "@/lib/supabase/server";
import { requireCanEditProject } from "@/lib/supabase/auth";
import { listTeamMembersForProject } from "@/lib/team/list";

/**
 * GET /api/proyectos/[projectId]/launches/[launchId]/report/commissions
 *
 * PDF "Comisiones cerradas" del launch. Una tabla por team_member con sus
 * ventas, pactado/cobrado, regla aplicada y comisión devengada. Total global
 * al pie.
 *
 * Permisos: `requireCanEditProject` (admin + superadmin). Plata = decisión
 * de admin; operador no exporta comisiones de otros. Esta es la única
 * diferencia de gate con el PDF ejecutivo del mismo launch.
 *
 * Defensa URL tampering: chequea `launch.project_id === projectId`.
 */
export async function GET(
  _request: Request,
  {
    params,
  }: { params: Promise<{ projectId: string; launchId: string }> },
) {
  const { projectId, launchId } = await params;
  await requireCanEditProject(projectId);

  const launch = await getLaunch(launchId);
  if (!launch || launch.project_id !== projectId) {
    return NextResponse.json({ error: "Lanzamiento no encontrado" }, { status: 404 });
  }

  const supabase = await createClient();
  const [projectRes, sales, rules, modalities, teamMembers] = await Promise.all([
    supabase
      .from("projects")
      .select("name, business_name")
      .eq("id", projectId)
      .maybeSingle(),
    listSalesByLaunch(projectId, launchId),
    listCommissionRules(projectId),
    listPaymentModalities(projectId),
    listTeamMembersForProject(projectId),
  ]);

  const project = projectRes.data as
    | { name: string; business_name: string | null }
    | null;
  if (!project) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }

  // Atribución por dueño del lead — fuente única de verdad. Hacemos un fetch
  // de leads.team_member_id sobre los leads que tocan las sales del launch,
  // y armamos el map sale_id → owner que consume el PDF.
  const leadOwnerBySaleId = new Map<string, string | null>();
  const leadIds = Array.from(new Set(sales.map((s) => s.sale.lead_id)));
  if (leadIds.length > 0) {
    const leadsRes = await supabase
      .from("leads")
      .select("id, team_member_id")
      .in("id", leadIds);
    const leadOwnerById = new Map<string, string | null>(
      ((leadsRes.data ?? []) as Array<{ id: string; team_member_id: string | null }>).map(
        (l) => [l.id, l.team_member_id],
      ),
    );
    for (const { sale } of sales) {
      leadOwnerBySaleId.set(sale.id, leadOwnerById.get(sale.lead_id) ?? null);
    }
  }

  const input: CommissionsLaunchInput = {
    projectName: project.name,
    projectBusinessName: project.business_name,
    launchId,
    launchName: launch.name,
    launchDateStart: launch.date_start,
    launchDateEnd: launch.date_end,
    sales,
    rules,
    modalities,
    teamMembers,
    leadOwnerBySaleId,
  };

  let buffer: Buffer;
  try {
    buffer = await renderCommissionsLaunchPdf(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : "render_failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const slug = slugifyForFilename(launch.name);
  const filename = `comisiones-${slug}-${stamp}.pdf`;

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
    // Combining diacritical marks (U+0300..U+036F).
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return normalized || "launch";
}
