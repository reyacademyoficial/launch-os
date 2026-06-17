import "server-only";

import { createClient } from "@/lib/supabase/server";

import {
  MAX_PAGE_SIZE,
  SORTABLE_COLUMNS,
  type LeadSearchResult,
  type SortableColumn,
  type SortDirection,
} from "./search-config";
import type { LeadRow, LeadSource, LeadStatus } from "./types";

/**
 * Búsqueda paginada server-side. La tabla de leads puede tener decenas de
 * miles de filas — TODO el filtrado, ordenado y paginado pasa por la DB.
 *
 * Diseño:
 *   - Filtros se traducen a `.eq()` directos (status, source, etc.) o `.gte/lte`
 *     (fechas). Cuando un filtro está vacío, se omite (no se aplica eq con "").
 *   - Search es un `.or()` sobre name/phone_normalized/email con `ilike` y
 *     se apoya en los índices GIN trigram (0016).
 *   - Sort va por columna whitelisteada (anti-SQL injection del parámetro de
 *     URL); si la columna pedida no está en la lista, fallback a created_at.
 *   - Count exacto en el mismo round-trip — Supabase devuelve `count` junto con
 *     `data` cuando pasás `{ count: "exact" }`.
 *
 * NO acepta "todas las filas del filtro" sin paginar — a 20k filas eso voltea
 * el browser. El consumer es la tabla con paginación visible.
 */

export interface LeadFilters {
  status?: LeadStatus;
  source?: LeadSource;
  teamMemberId?: string;
  launchId?: string;
  /** YYYY-MM-DD inclusive. */
  dateFrom?: string;
  /** YYYY-MM-DD inclusive. */
  dateTo?: string;
  /** Cuando es `true`, solo los pinneados al kanban. `undefined` = todos. */
  pinnedToKanban?: boolean;
  /**
   * Filtro por evergreen origen (0028). Tres modos:
   *   - uuid     → solo reciclados desde ese evergreen específico.
   *   - "any"    → cualquier lead reciclado (recycled_from IS NOT NULL).
   *   - "none"   → solo no-reciclados (recycled_from IS NULL).
   *   - undefined → sin filtrar.
   */
  recycledFrom?: string | "any" | "none";
}

export interface LeadSearchParams {
  projectId: string;
  page: number; // 1-indexed
  pageSize: number;
  filters: LeadFilters;
  /** Texto libre buscado en name/phone_normalized/email. Vacío = sin search. */
  search: string;
  sortColumn: SortableColumn;
  sortDirection: SortDirection;
}

export async function listLeadsPaginated(
  params: LeadSearchParams,
): Promise<LeadSearchResult> {
  const supabase = await createClient();
  const page = Math.max(1, params.page);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize));

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("leads")
    .select("*", { count: "exact" })
    .eq("project_id", params.projectId);

  // Filtros opcionales — solo aplicamos los que vienen seteados.
  const f = params.filters;
  if (f.status) query = query.eq("status", f.status);
  if (f.source) query = query.eq("source", f.source);
  if (f.teamMemberId) query = query.eq("team_member_id", f.teamMemberId);
  if (f.launchId) query = query.eq("launch_id", f.launchId);
  if (f.dateFrom) query = query.gte("created_at", f.dateFrom);
  if (f.dateTo) {
    // dateTo es inclusive → upper bound = inicio del día siguiente.
    // Pasamos a 23:59:59 para no requerir parseo del día.
    query = query.lte("created_at", `${f.dateTo}T23:59:59.999Z`);
  }
  if (typeof f.pinnedToKanban === "boolean") {
    query = query.eq("pinned_to_kanban", f.pinnedToKanban);
  }
  if (f.recycledFrom === "any") {
    query = query.not("recycled_from_launch_id", "is", null);
  } else if (f.recycledFrom === "none") {
    query = query.is("recycled_from_launch_id", null);
  } else if (f.recycledFrom) {
    query = query.eq("recycled_from_launch_id", f.recycledFrom);
  }

  // Búsqueda parcial: ilike en cualquiera de los 3 campos. Postgrest acepta
  // `or` con coma-separated list; los % wildcards van en el valor.
  const q = params.search.trim();
  if (q !== "") {
    const escaped = escapeIlike(q);
    query = query.or(
      `name.ilike.%${escaped}%,phone_normalized.ilike.%${escaped}%,email.ilike.%${escaped}%`,
    );
  }

  // Sort whitelisteado. Si llega algo fuera de la lista (URL manipulada),
  // fallback silencioso a created_at desc.
  const sortColumn = (SORTABLE_COLUMNS as ReadonlyArray<string>).includes(
    params.sortColumn,
  )
    ? params.sortColumn
    : "created_at";
  const ascending = params.sortDirection === "asc";

  query = query.order(sortColumn, { ascending }).range(from, to);

  const { data, count, error } = await query;
  if (error) throw new Error(error.message);

  const totalCount = count ?? 0;
  return {
    rows: (data ?? []) as unknown as LeadRow[],
    totalCount,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
  };
}

/**
 * Variante de `listLeadsPaginated` para exportar — mismo filtrado pero sin
 * paginación, con un cap defensivo. A escala esperada (~20k leads por brief)
 * el cap nunca se toca; existe para que un proyecto extremo no traiga 200k
 * filas y reviente el serializer (xlsx en memoria, CSV string en memoria).
 *
 * El cap se aplica server-side via `range(0, MAX_EXPORT_ROWS - 1)`. Si lo
 * tocamos, se marca `truncated = true` para que el caller decida qué hacer
 * (header de respuesta, banner, etc.).
 *
 * Permisos: los filtros + RLS aplican igual que en la versión paginada — solo
 * trae lo que el caller puede leer.
 */
export const MAX_EXPORT_ROWS = 50_000;

export interface LeadExportParams {
  projectId: string;
  filters: LeadFilters;
  search: string;
  sortColumn: SortableColumn;
  sortDirection: SortDirection;
}

export interface LeadExportResult {
  rows: LeadRow[];
  totalCount: number;
  truncated: boolean;
}

export async function listLeadsForExport(
  params: LeadExportParams,
): Promise<LeadExportResult> {
  const supabase = await createClient();

  let query = supabase
    .from("leads")
    .select("*", { count: "exact" })
    .eq("project_id", params.projectId);

  // Filtros — misma lógica que `listLeadsPaginated`. Mantenemos el copy/paste
  // a propósito porque chainear `.from().select()` con el client de Supabase
  // no se factoriza bien (cada `.eq()` devuelve un type narrowing nuevo).
  const f = params.filters;
  if (f.status) query = query.eq("status", f.status);
  if (f.source) query = query.eq("source", f.source);
  if (f.teamMemberId) query = query.eq("team_member_id", f.teamMemberId);
  if (f.launchId) query = query.eq("launch_id", f.launchId);
  if (f.dateFrom) query = query.gte("created_at", f.dateFrom);
  if (f.dateTo) query = query.lte("created_at", `${f.dateTo}T23:59:59.999Z`);
  if (typeof f.pinnedToKanban === "boolean") {
    query = query.eq("pinned_to_kanban", f.pinnedToKanban);
  }
  if (f.recycledFrom === "any") {
    query = query.not("recycled_from_launch_id", "is", null);
  } else if (f.recycledFrom === "none") {
    query = query.is("recycled_from_launch_id", null);
  } else if (f.recycledFrom) {
    query = query.eq("recycled_from_launch_id", f.recycledFrom);
  }

  const q = params.search.trim();
  if (q !== "") {
    const escaped = escapeIlike(q);
    query = query.or(
      `name.ilike.%${escaped}%,phone_normalized.ilike.%${escaped}%,email.ilike.%${escaped}%`,
    );
  }

  const sortColumn = (SORTABLE_COLUMNS as ReadonlyArray<string>).includes(
    params.sortColumn,
  )
    ? params.sortColumn
    : "created_at";
  const ascending = params.sortDirection === "asc";

  query = query.order(sortColumn, { ascending }).range(0, MAX_EXPORT_ROWS - 1);

  const { data, count, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as LeadRow[];
  const totalCount = count ?? rows.length;
  return {
    rows,
    totalCount,
    truncated: totalCount > rows.length,
  };
}

/**
 * Lee leads para el kanban — solo los pinned. Se mantiene la misma forma de
 * `listLeads` (devuelve LeadRow[]) para no romper el client del board.
 *
 * Sin paginación: el kanban es para volumen acotado por definición; si alguien
 * pinneo 5000 leads al tablero el bottleneck es la UI, no el query.
 */
export async function listKanbanLeads(projectId: string): Promise<LeadRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("leads")
    .select("*")
    .eq("project_id", projectId)
    .eq("pinned_to_kanban", true)
    .order("created_at", { ascending: false });

  return (data ?? []) as unknown as LeadRow[];
}

// ─── internals ──────────────────────────────────────────────────────────────

/**
 * Escapa los caracteres especiales de ilike (`%` y `_`) en el término buscado
 * para que un usuario no pueda hacer wildcard explosion por accidente.
 * También escapa `,` y `)` que rompen el query string del `.or()` de
 * postgrest-js (que es delimitado por coma).
 */
function escapeIlike(input: string): string {
  return input.replace(/[%_,()*]/g, "");
}
