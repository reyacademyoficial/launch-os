import "server-only";

import type { createClient } from "@/lib/supabase/server";

import type { ExpenseBucket } from "./expense-categories";
import { normalizeCategorySlug } from "./expense-categories";
import { getExpenseCategoriesAll } from "./reference";

// ═══════════════════════════════════════════════════════════════════════════
// Helpers server-side para leer el catálogo `expense_categories` (0167).
//
// Todo caller que necesite categorías para renderizar la UI o clasificar el
// P&L pasa por acá — nunca hardcodear otra vez.
// ═══════════════════════════════════════════════════════════════════════════

export interface ExpenseCategoryRow {
  readonly id: string;
  readonly slug: string;
  readonly label: string;
  readonly bucket: ExpenseBucket;
  readonly sortOrder: number;
  readonly isActive: boolean;
}

// El client server-side ya viene tipado con el Database generado — reutilizar
// el tipo evita otro `SupabaseClient<any, any, any>` disperso por el repo.
type AnySupabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Trae todas las categorías de la org actual (activas + inactivas). El caller
 * decide qué mostrar (form → activas; ABM y tabla histórica → todas).
 *
 * El parámetro `supabase` queda por compatibilidad — la resolución interna
 * pasa por `getExpenseCategoriesAll()` (cache scoped por org).
 */
export async function listExpenseCategories(
  _supabase?: AnySupabase,
): Promise<ExpenseCategoryRow[]> {
  return getExpenseCategoriesAll();
}

/**
 * Índice slug → bucket para `bucketOfCategory`. Se arma sobre las filas ya
 * fetcheadas — no dispara una query aparte.
 */
export function bucketMapFromCategories(
  categories: readonly ExpenseCategoryRow[],
): Map<string, ExpenseBucket> {
  const map = new Map<string, ExpenseBucket>();
  for (const c of categories) {
    map.set(normalizeCategorySlug(c.slug), c.bucket);
  }
  return map;
}

/**
 * Índice slug → label para presentar categorías históricas cuyo label pudo
 * haber cambiado en el ABM. Devuelve el label de DB si existe; si no, el
 * caller cae a su propio fallback.
 */
export function labelMapFromCategories(
  categories: readonly ExpenseCategoryRow[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of categories) {
    map.set(normalizeCategorySlug(c.slug), c.label);
  }
  return map;
}
