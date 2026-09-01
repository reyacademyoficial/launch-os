import {
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";

/**
 * País por defecto del proyecto. Aplica solo cuando el teléfono viene sin
 * prefijo internacional explícito (sin `+`). El wizard de import lo deja
 * elegir; los formularios manuales asumen AR.
 */
export const DEFAULT_COUNTRY: CountryCode = "AR";

/**
 * Normaliza un teléfono a E.164 — el formato que guarda
 * `leads.phone_normalized` y sobre el que corre el unique parcial
 * `(project_id, phone_normalized)`. Devuelve `null` si el input está vacío o
 * si no se puede parsear como número válido.
 *
 * Vive acá (y no en `leads/import.ts`) para que los formularios manuales
 * puedan normalizar igual que el import sin arrastrar exceljs ni `server-only`.
 */
export function normalizePhone(
  raw: string | null | undefined,
  defaultCountry: CountryCode = DEFAULT_COUNTRY,
): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (trimmed === "") return null;

  const parsed = parsePhoneNumberFromString(trimmed, defaultCountry);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.format("E.164");
}
