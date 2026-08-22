import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * course_parameters + student_parameter_values — Fase B del plan Academia
 * (migraciones 0145 y 0146). Este helper cubre CRUD de parámetros y set/read
 * de valores por enrollment.
 *
 * Los tipos son locales porque el schema generado por `supabase gen types`
 * todavía no incluye las tablas (se regenera después de aplicar migraciones).
 * Los payloads usan `as unknown as never` — workaround postgrest-js que
 * colapsa a `never` con el marcador __InternalSupabase.
 */

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type ParameterType = "boolean" | "integer" | "text";

export const PARAMETER_TYPES: readonly ParameterType[] = [
  "boolean",
  "integer",
  "text",
];

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
  | { readonly type: "integer"; readonly value: number }
  | { readonly type: "text"; readonly value: string };

// ─── Validación pura (para tests unitarios) ──────────────────────────────────

/**
 * Valida el shape de un CreateParameterInput. Devuelve `null` si es válido,
 * o un string con el error. Pura (sin DB) para poder testear.
 */
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
    return "type inválido (boolean | integer | text)";
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
  // key estable: minúsculas, dígitos, guiones bajos y guiones — evita
  // sorpresas si mañana se usa como identificador de integración.
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
 * Valida que un ParameterValueInput sea coherente con su tipo declarado.
 * Devuelve `null` si es válido, o un string con el error.
 * Pura — mirror TS del trigger `b_check_value_shape` de la DB.
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
  if (input.type === "text") {
    if (typeof input.value !== "string") {
      return "value debe ser string para type=text";
    }
    return null;
  }
  return "type de parámetro desconocido";
}

/**
 * Traduce un ParameterValueInput al triplete de columnas value_bool / value_int
 * / value_text que espera la DB. El campo del tipo se llena; los otros
 * quedan null (el trigger de la DB rebota si no es así).
 */
export function toValueColumns(input: ParameterValueInput): {
  value_bool: boolean | null;
  value_int: number | null;
  value_text: string | null;
} {
  if (input.type === "boolean") {
    return { value_bool: input.value, value_int: null, value_text: null };
  }
  if (input.type === "integer") {
    return { value_bool: null, value_int: input.value, value_text: null };
  }
  return { value_bool: null, value_int: null, value_text: input.value };
}

// ─── DB helpers ──────────────────────────────────────────────────────────────

export async function listParametersByCourse(
  courseId: string,
): Promise<CourseParameterRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("course_parameters")
    .select("*")
    .eq("course_id", courseId)
    .order("order_index", { ascending: true });
  return (data ?? []) as unknown as CourseParameterRow[];
}

/**
 * Crea un parámetro. Si order_index no se pasa, lo ubica al final.
 * project_id lo denormaliza el trigger de la DB — no hace falta pasarlo,
 * pero el NOT NULL exige un placeholder que el trigger sobreescribe.
 */
export async function createParameter(
  input: CreateParameterInput,
): Promise<CourseParameterRow> {
  const validationError = validateCreateParameterInput(input);
  if (validationError) throw new Error(validationError);

  const supabase = await createClient();

  let orderIndex = input.order_index;
  if (orderIndex === undefined) {
    const { data: last } = await supabase
      .from("course_parameters")
      .select("order_index")
      .eq("course_id", input.course_id)
      .order("order_index", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastIndex =
      (last as { order_index: number } | null)?.order_index ?? -1;
    orderIndex = lastIndex + 1;
  }

  const payload = {
    course_id: input.course_id,
    key: input.key.trim(),
    label: input.label.trim(),
    type: input.type,
    required: input.required ?? false,
    order_index: orderIndex,
    // project_id se autocompleta por trigger. NOT NULL exige un valor, así que
    // enviamos el mismo course_id y el trigger lo reemplaza por el real.
    project_id: input.course_id,
  } as unknown as never;

  const { data, error } = await supabase
    .from("course_parameters")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw error;
  return data as unknown as CourseParameterRow;
}

export async function updateParameter(
  parameterId: string,
  input: UpdateParameterInput,
): Promise<CourseParameterRow> {
  if (input.key !== undefined) {
    const err = validateParameterKey(input.key);
    if (err) throw new Error(err);
  }
  if (input.label !== undefined) {
    const err = validateParameterLabel(input.label);
    if (err) throw new Error(err);
  }
  if (
    input.type !== undefined &&
    !(PARAMETER_TYPES as readonly string[]).includes(input.type)
  ) {
    throw new Error("type inválido (boolean | integer | text)");
  }

  const supabase = await createClient();
  const patch: Record<string, unknown> = {};
  if (input.key !== undefined) patch.key = input.key.trim();
  if (input.label !== undefined) patch.label = input.label.trim();
  if (input.type !== undefined) patch.type = input.type;
  if (input.required !== undefined) patch.required = input.required;

  const { data, error } = await supabase
    .from("course_parameters")
    .update(patch as unknown as never)
    .eq("id", parameterId)
    .select("*")
    .single();

  if (error) throw error;
  return data as unknown as CourseParameterRow;
}

export async function deleteParameter(parameterId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("course_parameters")
    .delete()
    .eq("id", parameterId);
  if (error) throw error;
}

/**
 * Reasigna order_index a los parámetros del curso en el orden dado.
 * course_parameters.order_index NO es unique, pero mantenemos el patrón de
 * dos pasos por consistencia con modules y para evitar sorpresas.
 */
export async function reorderParameters(
  courseId: string,
  orderedIds: readonly string[],
): Promise<void> {
  const supabase = await createClient();

  for (let i = 0; i < orderedIds.length; i++) {
    const id = orderedIds[i];
    if (!id) continue;
    const payload = { order_index: -1 - i } as unknown as never;
    const { error } = await supabase
      .from("course_parameters")
      .update(payload)
      .eq("id", id)
      .eq("course_id", courseId);
    if (error) throw error;
  }

  for (let i = 0; i < orderedIds.length; i++) {
    const id = orderedIds[i];
    if (!id) continue;
    const payload = { order_index: i } as unknown as never;
    const { error } = await supabase
      .from("course_parameters")
      .update(payload)
      .eq("id", id)
      .eq("course_id", courseId);
    if (error) throw error;
  }
}

// ─── Values ──────────────────────────────────────────────────────────────────

export async function listParameterValuesForEnrollment(
  enrollmentId: string,
): Promise<StudentParameterValueRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("student_parameter_values")
    .select("*")
    .eq("enrollment_id", enrollmentId);
  return (data ?? []) as unknown as StudentParameterValueRow[];
}

/**
 * Upsert de un valor de parámetro para un enrollment. Recibe el value tipado
 * discriminado por type — así el TS chequea la coherencia en compile time,
 * el trigger de la DB lo revalida en runtime.
 *
 * updated_by se llena con el uid de la sesión actual si existe (nullable si
 * hay problema al leerlo — el registro no rebota por eso).
 */
export async function setParameterValue(
  enrollmentId: string,
  parameterId: string,
  input: ParameterValueInput,
): Promise<StudentParameterValueRow> {
  const validationError = validateParameterValue(input);
  if (validationError) throw new Error(validationError);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const columns = toValueColumns(input);

  const payload = {
    enrollment_id: enrollmentId,
    parameter_id: parameterId,
    // project_id lo autocompleta el trigger `a_denorm_project_id`. Placeholder
    // NOT NULL — el trigger reemplaza por el project del enrollment.
    project_id: enrollmentId,
    ...columns,
    updated_by: user?.id ?? null,
  } as unknown as never;

  const { data, error } = await supabase
    .from("student_parameter_values")
    .upsert(payload, { onConflict: "enrollment_id,parameter_id" })
    .select("*")
    .single();

  if (error) throw error;
  return data as unknown as StudentParameterValueRow;
}
