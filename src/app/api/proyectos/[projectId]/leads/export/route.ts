import { NextResponse } from "next/server";

import { buildLeadsCsv } from "@/lib/leads/export-csv";
import { buildLeadsWorkbook } from "@/lib/leads/export";
import {
  SORTABLE_COLUMNS,
  SORT_DIRECTIONS,
  type SortableColumn,
  type SortDirection,
} from "@/lib/leads/search-config";
import { listLeadsForExport } from "@/lib/leads/search";
import {
  LEAD_STATUSES,
  type LeadSource,
  type LeadStatus,
} from "@/lib/leads/types";
import { requireCanEditLaunchesIn } from "@/lib/supabase/auth";

/**
 * GET /api/proyectos/[projectId]/leads/export
 *
 * Exporta los leads del proyecto **respetando los filtros activos** de la
 * tabla (?q, ?status, ?source, ?setter, ?launch, ?from, ?to, ?pinned, ?sort,
 * ?dir). Los mismos parámetros que `LeadsPage` usa para `listLeadsPaginated`.
 *
 * Formato: `?format=csv` o `?format=xlsx`. Default xlsx para no romper enlaces
 * existentes (el botón viejo del import-modal usaba la URL sin format).
 *
 * Cap: 50k filas (ver `MAX_EXPORT_ROWS` en search.ts). Si se trunca, devuelve
 * el header `X-Leads-Export-Truncated: 1` con el total real en
 * `X-Leads-Export-Total`.
 *
 * Permisos: `requireCanEditLaunchesIn` — admin / operador / superadmin. Cliente
 * y analista no exportan (decisión consistente con el resto del CRM).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  await requireCanEditLaunchesIn(projectId);

  const url = new URL(request.url);
  const sp = url.searchParams;

  const format = sp.get("format") === "csv" ? "csv" : "xlsx";

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
  const teamMemberId = sp.get("setter") || undefined;
  const launchId = sp.get("launch") || undefined;
  const dateFrom = sp.get("from") || undefined;
  const dateTo = sp.get("to") || undefined;
  const pinnedToKanban = parsePinned(sp.get("pinned"));
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
    result = await listLeadsForExport({
      projectId,
      filters: {
        status,
        source,
        teamMemberId,
        launchId,
        dateFrom,
        dateTo,
        pinnedToKanban,
      },
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
    const csv = buildLeadsCsv(result.rows);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="leads-export-${stamp}.csv"`,
        "Cache-Control": "no-store",
        ...truncatedHeaders,
      },
    });
  }

  const buffer = await buildLeadsWorkbook(result.rows);
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="leads-export-${stamp}.xlsx"`,
      "Cache-Control": "no-store",
      ...truncatedHeaders,
    },
  });
}

// ─── helpers internos ──────────────────────────────────────────────────────

function filterLiteral(
  v: string | null,
  allowed: ReadonlyArray<string>,
): string | undefined {
  if (!v) return undefined;
  return allowed.includes(v) ? v : undefined;
}

/**
 * El filtro de "pinned" en la tabla puede venir como "true" / "false" / vacío.
 * Vacío = no filtra (mostrar todos). Esto matchea la lógica de
 * `listLeadsPaginated` (`typeof f.pinnedToKanban === "boolean"`).
 */
function parsePinned(v: string | null): boolean | undefined {
  if (v === "true") return true;
  if (v === "false") return false;
  return undefined;
}
