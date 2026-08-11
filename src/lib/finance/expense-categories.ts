/**
 * Vocabulario cerrado de categorías de `expenses`.
 *
 * La columna `expenses.category` es `text` (0063 línea 38, sin CHECK), pero
 * el FORMULARIO de alta y edición fuerza uno de estos 9 valores vía select.
 * Motivo: el gráfico "Estructura de egresos" del dashboard agrupa por este
 * string; si hoy alguien escribe `saas` y mañana `SaaS`, el gráfico se parte
 * en dos porciones de la misma cosa.
 *
 * Filas históricas cargadas antes de esta lista (o directamente en Studio)
 * con valores libres NO rompen — el selector de `expense_categories` en el
 * dashboard las agrupa como "Sin categoría". La constante restringe la UI,
 * no la DB.
 *
 * BASE DE ESTOS 9 — extraídos de los 44 gastos reales de Rey Academy que
 * vienen cargados como bank_movements (auditoría 6b-list):
 *
 *   - alquiler       → alquiler + expensas de oficina
 *   - servicios      → luz, agua, internet, teléfono, honorarios profesionales
 *   - software       → SaaS, dominios, licencias
 *   - publicidad     → pauta Meta / Google / Sendflow
 *   - oficina        → reformas, equipamiento, insumos
 *   - representacion → viáticos, cenas con clientes, llamadas 1-a-1
 *   - impuestos      → IIBB, ganancias, débitos y créditos
 *   - comisiones     → fees de Mercado Pago, Stripe, procesadores de pago
 *                      (costo financiero de procesar cobros)
 *   - otros          → ajustes, casos no categorizables
 *
 * SUELDOS NO ESTÁ — la nómina va a `payroll` (0066), no a expenses. Un
 * honorario profesional de un contratista sin relación laboral cae en
 * 'servicios' u 'otros'.
 *
 * NORMALIZACIÓN: minúscula, sin acentos, sin espacios. Facilita comparación
 * con filas históricas y evita diferencias sutiles (`Software` vs `software`).
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
 * Labels para presentar en la UI. La CLAVE es el valor guardado en DB (la
 * constante), el VALOR es lo que ve el humano. Es una diferencia superficial
 * (mayúscula inicial + tildes) — el valor persistido queda normalizado.
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
//   · OPERATING  → todo el resto (alquiler, servicios, software, oficina,
//                  representación, comisiones de procesadores, otros).
//
// Convención — si el negocio empieza a tratar otro rubro como directo
// (p.ej. IA como línea propia), extender la constante `DIRECT_COSTS`.
// Comparación tolerante: normaliza a minúscula + trim + sin acentos, así
// filas históricas con capitalización libre siguen clasificando.
// ═══════════════════════════════════════════════════════════════════════════

const DIRECT_COST_CATEGORIES = new Set<ExpenseCategory>(["publicidad"]);

const INCOME_TAX_CATEGORIES = new Set<ExpenseCategory>(["impuestos"]);

/**
 * Normaliza para matching contra las constantes. Minúscula, trim, y saca
 * tildes (representación → representacion). El vocabulario canónico ya
 * está sin tildes; esto es para tolerar filas viejas cargadas a mano.
 */
function normalizeCategory(category: string | null): string {
  if (category == null) return "";
  return category
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export type ExpenseBucket = "direct" | "tax" | "operating";

export function bucketOfCategory(category: string | null): ExpenseBucket {
  const n = normalizeCategory(category);
  if ((DIRECT_COST_CATEGORIES as Set<string>).has(n)) return "direct";
  if ((INCOME_TAX_CATEGORIES as Set<string>).has(n)) return "tax";
  return "operating";
}
