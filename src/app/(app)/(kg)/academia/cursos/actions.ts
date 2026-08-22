"use server";

import { revalidatePath } from "next/cache";

import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// CRUD de courses (bloque 4 · 0072).
//
// courses cuelga de products (unique product_id). project_id se
// denormaliza automáticamente por el trigger before_denorm_project_id_
// from_product — el action no lo pasa. El guard_propia_project rebota
// con 23514 si el product apunta a un project 'externa'.
//
// Delete es hard con guard: si hay cohorts referenciando este course,
// rebota. Alternativa suave: soft delete via active flag.
// ═══════════════════════════════════════════════════════════════════════════

export type CreateCourseState =
  | { ok: true; courseId: string }
  | { error: string }
  | null;

export type UpdateCourseState = { ok: true } | { error: string } | null;

export type DeleteCourseResult = { ok: true } | { error: string };

function nullIfEmpty(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

interface CoursePayload {
  readonly productId: string;
  readonly durationHours: number | null;
  readonly modulesCount: number | null;
  readonly active: boolean;
  readonly defaultAccessDays: number | null;
  readonly ghlExpirationWebhookUrl: string | null;
}

function parseCourseFormData(
  formData: FormData,
  { defaultActive }: { defaultActive: boolean },
): CoursePayload | string {
  const productId = nullIfEmpty(formData.get("product_id"));
  if (productId == null) return "Elegí un producto.";

  const durationRaw = nullIfEmpty(formData.get("duration_hours"));
  let durationHours: number | null = null;
  if (durationRaw != null) {
    const n = Number(durationRaw);
    if (!Number.isFinite(n) || n <= 0) {
      return "La duración tiene que ser un número positivo (o dejarlo vacío).";
    }
    durationHours = Math.round(n);
  }

  const modulesRaw = nullIfEmpty(formData.get("modules_count"));
  let modulesCount: number | null = null;
  if (modulesRaw != null) {
    const n = Number(modulesRaw);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
      return "Los módulos tienen que ser un entero positivo (o dejarlo vacío).";
    }
    modulesCount = n;
  }

  const accessDaysRaw = nullIfEmpty(formData.get("default_access_days"));
  let defaultAccessDays: number | null = null;
  if (accessDaysRaw != null) {
    const n = Number(accessDaysRaw);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
      return "Los días de acceso tienen que ser un entero positivo (o dejarlo vacío).";
    }
    defaultAccessDays = n;
  }

  const webhookRaw = nullIfEmpty(formData.get("ghl_expiration_webhook_url"));
  let ghlExpirationWebhookUrl: string | null = null;
  if (webhookRaw != null) {
    // Validación mínima — la URL de webhook GHL suele ser https.
    if (!/^https?:\/\//i.test(webhookRaw)) {
      return "La URL del webhook GHL tiene que empezar con http:// o https://.";
    }
    if (webhookRaw.length > 2048) {
      return "La URL del webhook GHL es demasiado larga (máx 2048).";
    }
    ghlExpirationWebhookUrl = webhookRaw;
  }

  const activeRaw = formData.get("active");
  const active =
    activeRaw === null ? defaultActive : String(activeRaw) === "on";

  return {
    productId,
    durationHours,
    modulesCount,
    active,
    defaultAccessDays,
    ghlExpirationWebhookUrl,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// createCourse
// ═══════════════════════════════════════════════════════════════════════════

export async function createCourse(
  _prev: CreateCourseState,
  formData: FormData,
): Promise<CreateCourseState> {
  const parsed = parseCourseFormData(formData, { defaultActive: true });
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();
  // project_id se autofillea via trigger desde products.
  const payload = {
    product_id: parsed.productId,
    duration_hours: parsed.durationHours,
    modules_count: parsed.modulesCount,
    active: parsed.active,
    default_access_days: parsed.defaultAccessDays,
    ghl_expiration_webhook_url: parsed.ghlExpirationWebhookUrl,
  } as never;

  const { data, error } = await supabase
    .from("courses")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { error: "Ese producto ya está registrado como curso." };
    }
    if (error.code === "23514") {
      return {
        error:
          "El producto pertenece a un proyecto que no es propia. Academia solo admite proyectos con ownership='propia'.",
      };
    }
    return { error: error.message };
  }

  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath("/academia/cursos");
  revalidatePath("/academia/estudiantes");
  revalidatePath("/academia");
  return { ok: true, courseId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateCourse
// ═══════════════════════════════════════════════════════════════════════════

export async function updateCourse(
  courseId: string,
  _prev: UpdateCourseState,
  formData: FormData,
): Promise<UpdateCourseState> {
  if (!courseId) return { error: "Falta el id del curso." };

  const parsed = parseCourseFormData(formData, { defaultActive: true });
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();
  const payload = {
    product_id: parsed.productId,
    duration_hours: parsed.durationHours,
    modules_count: parsed.modulesCount,
    active: parsed.active,
    default_access_days: parsed.defaultAccessDays,
    ghl_expiration_webhook_url: parsed.ghlExpirationWebhookUrl,
  } as never;

  const { error } = await supabase
    .from("courses")
    .update(payload)
    .eq("id", courseId);

  if (error) {
    if (error.code === "23505") {
      return { error: "Ese producto ya está registrado como otro curso." };
    }
    if (error.code === "23514") {
      return {
        error:
          "El producto pertenece a un proyecto que no es propia.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/academia/cursos");
  revalidatePath("/academia/estudiantes");
  revalidatePath("/academia");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// deleteCourse — hard delete con guard
//
// Bloquea si tiene cohorts asociados. Alternativa: archivar (active=
// false). Los cohorts sobreviven con course_id apuntando al mismo course
// mientras exista; si el course se borra sin cohorts, no hay problema.
// ═══════════════════════════════════════════════════════════════════════════

export async function deleteCourse(
  courseId: string,
): Promise<DeleteCourseResult> {
  if (!courseId) return { error: "Falta el id del curso." };

  const supabase = await createSupabaseClient();

  const { count } = await supabase
    .from("cohorts")
    .select("id", { count: "exact", head: true })
    .eq("course_id", courseId);

  if ((count ?? 0) > 0) {
    return {
      error:
        "No se puede eliminar: el curso tiene cohortes asociadas. Archivalo (destildar Activo) o desatá las cohortes primero.",
    };
  }

  const { error } = await supabase.from("courses").delete().eq("id", courseId);
  if (error) return { error: error.message };

  revalidatePath("/academia/cursos");
  revalidatePath("/academia/estudiantes");
  revalidatePath("/academia");
  return { ok: true };
}
