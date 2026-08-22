/**
 * course_parameters — helpers puros (tipos, validators, slugify, transform).
 *
 * Este archivo NO tiene `server-only` — vive en el bundle cliente y server.
 * Todas las funciones son puras: sin acceso a DB, sin next/headers, sin
 * cookies. Los helpers con acceso DB viven en `parameters.ts` (server-only)
 * y re-exportan desde acá.
 *
 * Extraído de parameters.ts cuando el editor cliente empezó a importar
 * slugifyToKey y el bundler intentó arrastrar todo el server-only.
 */

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type ParameterType = "boolean" | "integer";

export const PARAMETER_TYPES: readonly ParameterType[] = ["boolean", "integer"];

export interface CourseParameterRow {
  id: string;
  course_id: string;
  project_id: string;
  key: string;
  label: string;
  type: ParameterType;
  required: boolean;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface CreateParameterInput {
  course_id: string;
  key: string;
  label: string;
  type: ParameterType;
  required?: boolean;
  /** Si no se pasa, se ubica al final (max(order_index)+1). */
  order_index?: number;
}

export interface UpdateParameterInput {
  key?: string;
  label?: string;
  type?: ParameterType;
  required?: boolean;
}

export interface StudentParameterValueRow {
  id: string;
  enrollment_id: string;
  parameter_id: string;
  project_id: string;
  value_bool: boolean | null;
  value_int: number | null;
  value_text: string | null;
  updated_at: string;
  updated_by: string | null;
}

export type ParameterValueInput =
  | { readonly type: "boolean"; readonly value: boolean }
  | { readonly type: "integer"; readonly value: number };

// ─── Slugify (auto-key desde el nombre visible) ─────────────────────────────

/**
 * Convierte un nombre humano ("Diagnóstico hecho", "Sesiones de coaching")
 * en una key estable ("diagnostico-hecho", "sesiones-de-coaching") apta para
 * la unique constraint (course_id, key).
 */
export function slugifyToKey(name: string): string {
  const base = (name ?? "").trim();
  if (base.length === 0) return "";
  return base
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .replace(/-$/, "");
}

// ─── Validación pura ─────────────────────────────────────────────────────────

export function validateCreateParameterInput(
  input: CreateParameterInput,
): string | null {
  if (!input.course_id || input.course_id.trim().length === 0) {
    return "course_id es requerido";
  }
  const keyErr = validateParameterKey(input.key);
  if (keyErr) return keyErr;
  const labelErr = validateParameterLabel(input.label);
  if (labelErr) return labelErr;
  if (!(PARAMETER_TYPES as readonly string[]).includes(input.type)) {
    return "type inválido (boolean | integer)";
  }
  if (
    input.order_index !== undefined &&
    (!Number.isInteger(input.order_index) || input.order_index < 0)
  ) {
    return "order_index debe ser un entero >= 0";
  }
  return null;
}

export function validateParameterKey(key: string): string | null {
  const trimmed = (key ?? "").trim();
  if (trimmed.length === 0) return "key es requerido";
  if (trimmed.length > 60) return "key no puede tener más de 60 caracteres";
  if (!/^[a-z0-9_-]+$/.test(trimmed)) {
    return "key solo admite minúsculas, dígitos, guiones y guiones bajos";
  }
  return null;
}

export function validateParameterLabel(label: string): string | null {
  const trimmed = (label ?? "").trim();
  if (trimmed.length === 0) return "label es requerido";
  if (trimmed.length > 120) return "label no puede tener más de 120 caracteres";
  return null;
}

/**
 * Mirror TS del trigger `b_check_value_shape` de la DB.
 */
export function validateParameterValue(
  input: ParameterValueInput,
): string | null {
  if (input.type === "boolean") {
    if (typeof input.value !== "boolean") {
      return "value debe ser boolean para type=boolean";
    }
    return null;
  }
  if (input.type === "integer") {
    if (typeof input.value !== "number" || !Number.isInteger(input.value)) {
      return "value debe ser un entero para type=integer";
    }
    return null;
  }
  return "type de parámetro desconocido";
}

/**
 * Traduce un ParameterValueInput al triplete de columnas value_bool /
 * value_int / value_text que espera la DB.
 */
export function toValueColumns(input: ParameterValueInput): {
  value_bool: boolean | null;
  value_int: number | null;
  value_text: string | null;
} {
  if (input.type === "boolean") {
    return { value_bool: input.value, value_int: null, value_text: null };
  }
  return { value_bool: null, value_int: input.value, value_text: null };
}
