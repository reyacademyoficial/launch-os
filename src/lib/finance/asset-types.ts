/**
 * Tipos de `assets`. Espeja el CHECK del schema (0067) — si algún día se
 * amplía, hay que actualizar los dos lados a la vez. El linter de TS no
 * detecta la divergencia porque el CHECK es de DB, pero un test de inserción
 * inválido lo cazaría; hoy no hace falta.
 *
 * Los valores se guardan en minúscula, sin acentos, sin espacios — igual
 * criterio que `expense-categories` para que el gráfico de balance agrupe
 * bien y las URLs (?type=banco) sean estables.
 */

export const ASSET_TYPES = [
  "caja",
  "banco",
  "inversion",
  "inmueble",
  "equipo",
  "muebles",
  "intangible",
  "credito",
  "otro",
] as const;

export type AssetType = (typeof ASSET_TYPES)[number];

/**
 * Etiquetas para la UI. Clave = valor de DB, valor = lo que ve el humano.
 * "Crédito" acá refiere a un crédito por cobrar (activo), no a una tarjeta
 * de crédito. La denominación coincide con la convención contable AR.
 */
export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  caja: "Caja",
  banco: "Banco",
  inversion: "Inversión",
  inmueble: "Inmueble",
  equipo: "Equipo",
  muebles: "Muebles",
  intangible: "Intangible",
  credito: "Crédito por cobrar",
  otro: "Otro",
};

export function isValidAssetType(value: unknown): value is AssetType {
  return (
    typeof value === "string" && (ASSET_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Los tipos que el selector de Caja del dashboard financiero suma como saldo
 * disponible. Se exporta como `readonly string[]` a propósito — el consumer
 * lo usa con `.includes(row.asset_type)` sobre una columna DB tipada como
 * text; usar `readonly AssetType[]` obligaría a un cast en el borde.
 */
export const CASH_ASSET_TYPES: readonly string[] = ["caja", "banco"];
