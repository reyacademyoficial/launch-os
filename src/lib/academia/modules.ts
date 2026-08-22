import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * course_modules — unidades de contenido dentro de un curso. Migración 0143.
 *
 * Este helper cubre CRUD + reorder. Los tipos son locales porque el schema
 * generado por supabase gen types todavía no incluye la tabla (se regenera
 * después de aplicar la migración).
 */

export interface CourseModuleRow {
  id: string;
  course_id: string;
  project_id: string;
  name: string;
  description: string | null;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface CreateCourseModuleInput {
  course_id: string;
  name: string;
  description?: string | null;
  /** Si no se pasa, se ubica al final (max(order_index)+1). */
  order_index?: number;
}

export interface UpdateCourseModuleInput {
  name?: string;
  description?: string | null;
}

export async function listModulesByCourse(
  courseId: string,
): Promise<CourseModuleRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("course_modules")
    .select("*")
    .eq("course_id", courseId)
    .order("order_index", { ascending: true });
  return (data ?? []) as unknown as CourseModuleRow[];
}

/**
 * Crea un módulo. Si order_index no se pasa, lo ubica al final.
 * project_id lo denormaliza el trigger de la DB — no hace falta pasarlo.
 */
export async function createModule(
  input: CreateCourseModuleInput,
): Promise<CourseModuleRow> {
  const supabase = await createClient();

  let orderIndex = input.order_index;
  if (orderIndex === undefined) {
    const { data: last } = await supabase
      .from("course_modules")
      .select("order_index")
      .eq("course_id", input.course_id)
      .order("order_index", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastIndex = (last as { order_index: number } | null)?.order_index ?? -1;
    orderIndex = lastIndex + 1;
  }

  const payload = {
    course_id: input.course_id,
    name: input.name,
    description: input.description ?? null,
    order_index: orderIndex,
    // project_id se autocompleta por trigger — pasamos un placeholder que
    // el trigger sobreescribe. NOT NULL exige un valor, así que enviamos el
    // mismo course_id y el trigger lo reemplaza por el project real.
    project_id: input.course_id,
  } as unknown as never;

  const { data, error } = await supabase
    .from("course_modules")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw error;
  return data as unknown as CourseModuleRow;
}

export async function updateModule(
  moduleId: string,
  input: UpdateCourseModuleInput,
): Promise<CourseModuleRow> {
  const supabase = await createClient();
  const payload = {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.description !== undefined && { description: input.description }),
  } as unknown as never;

  const { data, error } = await supabase
    .from("course_modules")
    .update(payload)
    .eq("id", moduleId)
    .select("*")
    .single();

  if (error) throw error;
  return data as unknown as CourseModuleRow;
}

export async function deleteModule(moduleId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("course_modules")
    .delete()
    .eq("id", moduleId);
  if (error) throw error;
}

/**
 * Reasigna order_index a una lista completa de módulos de un curso. Recibe
 * los ids en el orden deseado y les asigna 0, 1, 2, ... en batch.
 *
 * Nota: la unique(course_id, order_index) obliga a hacer el reorder en 2
 * pasos para evitar colisiones — primero movés todos a un rango negativo
 * temporal, después al final asignás los positivos.
 */
export async function reorderModules(
  courseId: string,
  orderedIds: readonly string[],
): Promise<void> {
  const supabase = await createClient();

  // Paso 1: mover todos los módulos del curso a índices negativos temporales
  // para liberar el rango 0..N-1.
  for (let i = 0; i < orderedIds.length; i++) {
    const id = orderedIds[i];
    if (!id) continue;
    const payload = { order_index: -1 - i } as unknown as never;
    const { error } = await supabase
      .from("course_modules")
      .update(payload)
      .eq("id", id)
      .eq("course_id", courseId);
    if (error) throw error;
  }

  // Paso 2: asignar los índices finales 0..N-1.
  for (let i = 0; i < orderedIds.length; i++) {
    const id = orderedIds[i];
    if (!id) continue;
    const payload = { order_index: i } as unknown as never;
    const { error } = await supabase
      .from("course_modules")
      .update(payload)
      .eq("id", id)
      .eq("course_id", courseId);
    if (error) throw error;
  }
}
