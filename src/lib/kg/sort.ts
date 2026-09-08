/**
 * Comparador genérico para el orden por encabezado (client-side) de las
 * tablas del pipeline de Producción. Los valores ya vienen resueltos a
 * texto/número/fecha-ISO por cada vista — este helper solo define el orden
 * relativo, con nulos siempre al final (en cualquier dirección, para que
 * "sin fecha"/"sin asignar" no salte al frente al invertir el orden).
 */
export type SortValue = string | number | null;

export function compareSortValues(a: SortValue, b: SortValue): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "es");
}
