import { NextResponse } from "next/server";

import {
  buildClientLeadsCsv,
  buildClientLeadsWorkbook,
} from "@/lib/client-portal/export";
import { listClientLeadsForExport } from "@/lib/client-portal/leads";
import {
  SORTABLE_COLUMNS,
  SORT_DIRECTIONS,
  type SortableColumn,
  type SortDirection,
} from "@/lib/leads/search-config";
import {
  LEAD_STATUSES,
  type LeadSource,
  type LeadStatus,
} from "@/lib/leads/types";
import { requireRole } from "@/lib/supabase/auth";

/**
 * GET /api/portal/proyectos/[projectId]/leads/export?format=csv|xlsx
 *
 * Export del portal del cliente. Diff vs el del equipo:
 *   - Gate por rol: requireRole('cliente'). Otros roles entran por
 *     /api/proyectos/[id]/leads/export, no por acá.
 *   - Lib de salida: `buildClientLeadsCsv` / `buildClientLeadsWorkbook` con
 *     `ClientLeadRow` (sin team_member_id).
 *   - Filtros del cliente: `?q`, `?status`, `?launch`, `?from`, `?to`. No
 *     hay setter/closer filter — esa columna no existe en su vista.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  await requireRole("cliente");

  const url = new URL(request.url);
  const sp = url.searchParams;
  const format = sp.get("format") === "xlsx" ? "xlsx" : "csv";

  const status = filterLiteral(
    sp.get("status"),
    LEAD_STATUSES as ReadonlyArray<string>,
  ) as LeadStatus | undefined;
  const source = filterLiteral(sp.get("source"), [
    "manual",
    "import",
    "meta",
    "ghl",
    "whatsapp",
    "otro",
  ]) as LeadSource | undefined;
  const launchId = sp.get("launch") || undefined;
  const dateFrom = sp.get("from") || undefined;
  const dateTo = sp.get("to") || undefined;
  const search = sp.get("q") ?? "";

  const sortColumn = (filterLiteral(
    sp.get("sort"),
    SORTABLE_COLUMNS as ReadonlyArray<string>,
  ) ?? "created_at") as SortableColumn;
  const sortDirection = (filterLiteral(
    sp.get("dir"),
    SORT_DIRECTIONS as ReadonlyArray<string>,
  ) ?? "desc") as SortDirection;

  let result;
  try {
    result = await listClientLeadsForExport({
      projectId,
      filters: { status, source, launchId, dateFrom, dateTo },
      search,
      sortColumn,
      sortDirection,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const truncatedHeaders: Record<string, string> = result.truncated
    ? {
        "X-Leads-Export-Truncated": "1",
        "X-Leads-Export-Total": String(result.totalCount),
      }
    : {};

  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "csv") {
    const csv = buildClientLeadsCsv(result.rows);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="leads-${stamp}.csv"`,
        "Cache-Control": "no-store",
        ...truncatedHeaders,
      },
    });
  }

  const buffer = await buildClientLeadsWorkbook(result.rows);
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="leads-${stamp}.xlsx"`,
      "Cache-Control": "no-store",
      ...truncatedHeaders,
    },
  });
}

function filterLiteral(
  v: string | null,
  allowed: ReadonlyArray<string>,
): string | undefined {
  if (!v) return undefined;
  return allowed.includes(v) ? v : undefined;
}
