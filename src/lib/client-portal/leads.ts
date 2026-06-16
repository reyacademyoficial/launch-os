import "server-only";

import {
  MAX_PAGE_SIZE,
  SORTABLE_COLUMNS,
  type SortableColumn,
  type SortDirection,
} from "@/lib/leads/search-config";
import type { LeadSource, LeadStatus } from "@/lib/leads/types";
import { createClient } from "@/lib/supabase/server";

import type { ClientLeadRow, ClientLeadSearchResult } from "./types";

/**
 * Lista de columnas legibles para el cliente — espejo en TS del grant
 * column-level a `cliente_role` (migración 0023). Si la migración suma o
 * quita columnas safe, esta lista tiene que reflejarlo o el cliente recibe
 * 42501 al pedir una columna fuera del grant.
 *
 * Explícita en select y NO `*`: con `*` postgREST pediría todas las
 * columnas, incluyendo `team_member_id`, y el grant la rechazaría.
 */
const SAFE_LEAD_COLUMNS = [
  "id",
  "project_id",
  "launch_id",
  "name",
  "contact",
  "email",
  "phone_normalized",
  "external_id",
  "pinned_to_kanban",
  "source",
  "status",
  "notes",
  "created_at",
  "updated_at",
].join(", ");

export interface ClientLeadFilters {
  status?: LeadStatus;
  source?: LeadSource;
  launchId?: string;
  /** YYYY-MM-DD inclusive. */
  dateFrom?: string;
  /** YYYY-MM-DD inclusive. */
  dateTo?: string;
}

export interface ClientLeadSearchParams {
  projectId: string;
  page: number;
  pageSize: number;
  filters: ClientLeadFilters;
  search: string;
  sortColumn: SortableColumn;
  sortDirection: SortDirection;
}

export async function listClientLeadsPaginated(
  params: ClientLeadSearchParams,
): Promise<ClientLeadSearchResult> {
  const supabase = await createClient();
  const page = Math.max(1, params.page);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("leads")
    .select(SAFE_LEAD_COLUMNS, { count: "exact" })
    .eq("project_id", params.projectId);

  const f = params.filters;
  if (f.status) query = query.eq("status", f.status);
  if (f.source) query = query.eq("source", f.source);
  if (f.launchId) query = query.eq("launch_id", f.launchId);
  if (f.dateFrom) query = query.gte("created_at", f.dateFrom);
  if (f.dateTo) query = query.lte("created_at", `${f.dateTo}T23:59:59.999Z`);

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

  query = query.order(sortColumn, { ascending }).range(from, to);

  const { data, count, error } = await query;
  if (error) throw new Error(error.message);

  const totalCount = count ?? 0;
  return {
    rows: (data ?? []) as unknown as ClientLeadRow[],
    totalCount,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
  };
}

/**
 * Variante "todas las filas" para export. Cap defensivo idéntico al del
 * equipo — el cap no se toca en práctica a la escala esperada.
 */
export const MAX_CLIENT_EXPORT_ROWS = 50_000;

export interface ClientLeadExportParams {
  projectId: string;
  filters: ClientLeadFilters;
  search: string;
  sortColumn: SortableColumn;
  sortDirection: SortDirection;
}

export interface ClientLeadExportResult {
  rows: ClientLeadRow[];
  totalCount: number;
  truncated: boolean;
}

export async function listClientLeadsForExport(
  params: ClientLeadExportParams,
): Promise<ClientLeadExportResult> {
  const supabase = await createClient();

  let query = supabase
    .from("leads")
    .select(SAFE_LEAD_COLUMNS, { count: "exact" })
    .eq("project_id", params.projectId);

  const f = params.filters;
  if (f.status) query = query.eq("status", f.status);
  if (f.source) query = query.eq("source", f.source);
  if (f.launchId) query = query.eq("launch_id", f.launchId);
  if (f.dateFrom) query = query.gte("created_at", f.dateFrom);
  if (f.dateTo) query = query.lte("created_at", `${f.dateTo}T23:59:59.999Z`);

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

  query = query
    .order(sortColumn, { ascending })
    .range(0, MAX_CLIENT_EXPORT_ROWS - 1);

  const { data, count, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as ClientLeadRow[];
  const totalCount = count ?? rows.length;
  return { rows, totalCount, truncated: totalCount > rows.length };
}

function escapeIlike(input: string): string {
  return input.replace(/[%_,()*]/g, "");
}
