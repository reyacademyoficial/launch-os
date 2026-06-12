/**
 * Constantes y tipos del import xlsx que pueden viajar al cliente (wizard UI).
 * Aislados de `import.ts` porque ése depende de exceljs/libphonenumber y es
 * `server-only`.
 */

export const IMPORT_FIELDS = ["name", "phone", "email", "contact"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export interface ImportMapping {
  name: string;
  phone?: string;
  email?: string;
  contact?: string;
}

export interface ImportPreview {
  /** Headers de la primera fila, en el orden del xlsx. */
  headers: string[];
  /** Primeras N filas (sin header) como objetos { header: valor }. */
  sampleRows: ReadonlyArray<Record<string, string>>;
  /** Total de filas de datos detectadas (excluyendo header). */
  totalRowsApprox: number;
}
