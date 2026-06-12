import { NextResponse } from "next/server";

import { buildTemplateWorkbook } from "@/lib/leads/export";
import { requireCanEditLaunchesIn } from "@/lib/supabase/auth";

/**
 * GET /api/proyectos/[projectId]/leads/template
 * Devuelve un xlsx de muestra con los headers que el wizard espera +
 * 2 filas de ejemplo. Requiere permiso de edición (mismo gate que el import).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  await requireCanEditLaunchesIn(projectId);

  const buffer = await buildTemplateWorkbook();
  // Uint8Array<ArrayBufferLike> es válido como BodyInit en runtime pero el
  // lib.dom typing pide BodyInit explícito. Cast directo.
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="leads-plantilla.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
