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
