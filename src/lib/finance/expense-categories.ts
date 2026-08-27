/**
 * Categorías de `expenses`.
 *
 * Fuente de verdad: tabla `expense_categories` (0167). Este archivo mantiene:
 *
 *   1. Las 9 categorías HISTÓRICAS que existían antes de mover el vocabulario
 *      a DB. Se usan como semilla en 0167 y como fallback de bucket para
 *      filas cuyo `expenses.category` no está en el catálogo actual (borrado
 *      con soft-delete + re-escritura del slug, o import xlsx con typo).
 *
 *   2. `bucketOfCategory(category, bucketMap?)` — clasificador del P&L.
 *      Si el caller pasa un `bucketMap` (obtenido de la DB), gana ese; sino
 *      cae al mapa hardcodeado de las 9 semillas. Los llamadores server-side
 *      (dashboard Financiero, dashboard Ejecutivo) leen el mapa por org y lo
 *      pasan; los tests + usos sin contexto usan el fallback.
 *
 * La columna `expenses.category` sigue siendo `text` libre — no hay FK.
 * Motivo: cambiar el slug de una categoría no invalida gastos históricos,
 * y un import xlsx con "SaaS" (no listado) cae como "Sin categoría" en el
 * gráfico sin romper el insert.
 */

/**
 * Semilla histórica. Cambiar valores NO modifica lo que ve el usuario en
 * runtime — para eso está el ABM. Se mantiene como fallback para gastos
 * viejos y como referencia del seed inicial (ver 0167).
 */
export const EXPENSE_CATEGORIES = [
  "alquiler",
  "servicios",
  "software",
  "publicidad",
  "oficina",
  "representacion",
  "impuestos",
  "comisiones",
  "otros",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/**
 * Labels de las 9 semilla. Sólo se usan para gastos viejos cuya categoría
 * matchea uno de estos slugs pero cuyo label pudo haber sido editado en el
 * ABM — en ese caso el runtime prefiere el label de DB (ver
 * `expense-categories-repo.ts`).
 */
export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  alquiler: "Alquiler",
  servicios: "Servicios",
  software: "Software",
  publicidad: "Publicidad",
  oficina: "Oficina",
  representacion: "Representación",
  impuestos: "Impuestos",
  comisiones: "Comisiones",
  otros: "Otros",
};

export function isValidExpenseCategory(
  value: unknown,
): value is ExpenseCategory {
  return (
    typeof value === "string" &&
    (EXPENSE_CATEGORIES as readonly string[]).includes(value)
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Bucketing para el estado de resultados (P&L)
//
// El P&L parte los expenses en tres canaletas:
//   · DIRECT     → costos atribuibles a lanzamientos (publicidad).
//                  NO incluye comisiones de equipo — esas vienen de
//                  `team_member_payouts` (tabla aparte con `launch_id`).
//   · TAX        → impuestos que restan de la utilidad (Ganancias, IIBB,
//                  débitos y créditos). NO el IVA — ese ya se descuenta
//                  vía `tax_amount` en cada línea.
//   · OPERATING  → default (alquiler, servicios, software, oficina,
//                  representación, comisiones de procesadores, otros).
//
// Fallback histórico — sólo se usa cuando la DB no está disponible o cuando
// el slug del gasto no matchea ninguna categoría del catálogo actual.
// ═══════════════════════════════════════════════════════════════════════════

export type ExpenseBucket = "direct" | "tax" | "operating";

const FALLBACK_BUCKET_BY_SLUG: Record<ExpenseCategory, ExpenseBucket> = {
  alquiler: "operating",
  servicios: "operating",
  software: "operating",
  publicidad: "direct",
  oficina: "operating",
  representacion: "operating",
  impuestos: "tax",
  comisiones: "operating",
  otros: "operating",
};

/**
 * Normaliza para matching. Minúscula, trim, y saca tildes
 * (representación → representacion). El vocabulario canónico ya está sin
 * tildes; esto es para tolerar filas viejas cargadas a mano.
 */
export function normalizeCategorySlug(category: string | null): string {
  if (category == null) return "";
  return category
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Clasifica una categoría en su bucket del P&L.
 *
 * - Si el caller pasa `bucketBySlug` (mapa desde DB), gana ese.
 * - Si no, cae al fallback hardcodeado de las 9 semillas.
 * - Si la categoría no matchea ninguno de los dos, retorna 'operating'.
 */
export function bucketOfCategory(
  category: string | null,
  bucketBySlug?: ReadonlyMap<string, ExpenseBucket>,
): ExpenseBucket {
  const slug = normalizeCategorySlug(category);
  if (slug === "") return "operating";
  if (bucketBySlug) {
    const fromDb = bucketBySlug.get(slug);
    if (fromDb) return fromDb;
  }
  return (
    FALLBACK_BUCKET_BY_SLUG[slug as ExpenseCategory] ?? "operating"
  );
}
