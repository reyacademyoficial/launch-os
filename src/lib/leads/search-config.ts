/**
 * Constantes y tipos compartidos entre el server (`search.ts`, RSC pages) y
 * el cliente (`leads-table.tsx`). Aislados acá para que el cliente no importe
 * `server-only` por transitividad.
 */

import type { LeadRow, LeadSource } from "./types";

export const SORTABLE_COLUMNS = [
  "name",
  "created_at",
  "updated_at",
  "status",
  "source",
] as const;
export type SortableColumn = (typeof SORTABLE_COLUMNS)[number];

export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export const SOURCES: ReadonlyArray<LeadSource> = [
  "manual",
  "import",
  "meta",
  "ghl",
  "otro",
];

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export interface LeadSearchResult {
  rows: LeadRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
