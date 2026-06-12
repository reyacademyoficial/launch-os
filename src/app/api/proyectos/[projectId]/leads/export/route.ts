import { NextResponse } from "next/server";

import { buildLeadsWorkbook } from "@/lib/leads/export";
import type { LeadRow } from "@/lib/leads/types";
import { requireCanEditLaunchesIn } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/proyectos/[projectId]/leads/export
 * Devuelve un xlsx con TODOS los leads del proyecto.
 *
 * Sin paginación: el caller esperaba ya tener el dataset entero (es el caso de
 * uso del export). Para proyectos con cientos de miles de leads convendría
 * stream → S3 → signed URL; a la escala actual (~20k máximo por brief) lo
 * resuelve un solo query + writeBuffer.
 *
 * Permisos: SELECT está abierto para todo miembro del proyecto via RLS, pero
 * gateamos a "puede editar launches" para que `cliente` no exporte la base
 * entera (decisión consistente con el resto del CRM).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  await requireCanEditLaunchesIn(projectId); // exige sesión + permiso

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as LeadRow[];
  const buffer = await buildLeadsWorkbook(rows);
  const filename = `leads-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
