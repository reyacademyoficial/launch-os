import "server-only";

import { createClient } from "@/lib/supabase/server";

import {
  PARAMETER_TYPES,
  validateCreateParameterInput,
  validateParameterKey,
  validateParameterLabel,
  validateParameterValue,
  toValueColumns,
  type CourseParameterRow,
  type CreateParameterInput,
  type ParameterValueInput,
  type StudentParameterValueRow,
  type UpdateParameterInput,
} from "./parameters-shared";

/**
 * course_parameters + student_parameter_values — server-only DB helpers.
 *
 * Los tipos, validators y slugify puros viven en `parameters-shared.ts` para
 * poder importarse desde client components sin arrastrar next/headers.
 * Se re-exportan acá para que los callers server-side no tengan que cambiar
 * de import path.
 */

// Re-export para que server callers sigan funcionando con el mismo import.
export {
  PARAMETER_TYPES,
  slugifyToKey,
  validateCreateParameterInput,
  validateParameterKey,
  validateParameterLabel,
  validateParameterValue,
  toValueColumns,
} from "./parameters-shared";
export type {
  CourseParameterRow,
  CreateParameterInput,
  ParameterType,
  ParameterValueInput,
  StudentParameterValueRow,
  UpdateParameterInput,
} from "./parameters-shared";

// ─── DB helpers (server-only) ────────────────────────────────────────────────

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
    throw new Error("type inválido (boolean | integer)");
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
    // project_id lo autocompleta el trigger `a_denorm_project_id`.
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
