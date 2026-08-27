"use server";

import { revalidatePath } from "next/cache";

import {
  normalizeCategorySlug,
  type ExpenseBucket,
} from "@/lib/finance/expense-categories";
import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// ABM del catálogo `expense_categories` (0167).
//
// Baja = soft-delete via `is_active=false` (decisión de UX): no rompe gastos
// históricos que apunten al slug y permite reactivar. La UI del form de
// gastos filtra las inactivas del select; la tabla / gráfico de estructura
// siguen mostrando el label si un gasto viejo apunta al slug.
// ═══════════════════════════════════════════════════════════════════════════

export type CreateCategoryState =
  | { ok: true; id: string }
  | { error: string }
  | null;

export type UpdateCategoryState =
  | { ok: true }
  | { error: string }
  | null;

export type ToggleCategoryResult = { ok: true } | { error: string };

const VALID_BUCKETS: readonly ExpenseBucket[] = [
  "direct",
  "tax",
  "operating",
];

function parseBucket(raw: unknown): ExpenseBucket | null {
  if (typeof raw !== "string") return null;
  return (VALID_BUCKETS as readonly string[]).includes(raw)
    ? (raw as ExpenseBucket)
    : null;
}

function parseSortOrder(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 100;
  return Math.max(0, Math.min(9999, Math.round(n)));
}

// ─── createCategory ──────────────────────────────────────────────────────

export async function createExpenseCategory(
  _prev: CreateCategoryState,
  formData: FormData,
): Promise<CreateCategoryState> {
  await requireRole("superadmin");

  const label = String(formData.get("label") ?? "").trim();
  if (label.length === 0) return { error: "El nombre es obligatorio." };
  if (label.length > 60) {
    return { error: "El nombre no puede superar 60 caracteres." };
  }

  const bucket = parseBucket(formData.get("bucket"));
  if (!bucket) {
    return { error: "Elegí un tipo (Directo, Impuesto u Operativo)." };
  }

  // Slug derivado del label — el usuario solo escribe una vez. Si dos
  // labels distintos normalizan al mismo slug (ej "Software" vs "software "),
  // el unique index de 0167 tira 23505 y traducimos.
  const slug = normalizeCategorySlug(label);
  if (slug.length === 0) {
    return {
      error: "El nombre tiene que incluir letras o números.",
    };
  }

  const sortOrder = parseSortOrder(formData.get("sort_order"));

  let organizationId: string | null;
  try {
    organizationId = await resolveCurrentOrganizationId();
  } catch (e) {
    return {
      error:
        e instanceof Error ? e.message : "Error resolviendo la organización.",
    };
  }
  if (!organizationId) {
    return {
      error: "No pudimos resolver tu organización. Revisá tus permisos.",
    };
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("expense_categories")
    .insert({
      organization_id: organizationId,
      slug,
      label,
      bucket,
      sort_order: sortOrder,
      is_active: true,
    } as never)
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        error: `Ya existe una categoría con nombre "${label}" (mismo slug: ${slug}).`,
      };
    }
    return { error: error.message ?? "Error creando la categoría." };
  }

  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath("/financiero/gastos");
  revalidatePath("/financiero");
  return { ok: true, id: created.id };
}

// ─── updateCategory ──────────────────────────────────────────────────────
//
// NO se edita `slug`: gastos históricos apuntan al slug persistido en
// `expenses.category` y cambiarlo los rompería (aparecerían como "Sin
// categoría" en el gráfico). Si el humano se equivocó con el nombre, la
// mejor opción es dar de baja la categoría vieja + crear una nueva.

export async function updateExpenseCategory(
  categoryId: string,
  _prev: UpdateCategoryState,
  formData: FormData,
): Promise<UpdateCategoryState> {
  await requireRole("superadmin");

  if (!categoryId) return { error: "Falta el id de la categoría." };

  const label = String(formData.get("label") ?? "").trim();
  if (label.length === 0) return { error: "El nombre es obligatorio." };
  if (label.length > 60) {
    return { error: "El nombre no puede superar 60 caracteres." };
  }

  const bucket = parseBucket(formData.get("bucket"));
  if (!bucket) {
    return { error: "Elegí un tipo (Directo, Impuesto u Operativo)." };
  }

  const sortOrder = parseSortOrder(formData.get("sort_order"));

  const supabase = await createClient();
  const { error } = await supabase
    .from("expense_categories")
    .update({
      label,
      bucket,
      sort_order: sortOrder,
    } as never)
    .eq("id", categoryId);

  if (error) {
    return { error: error.message ?? "Error actualizando la categoría." };
  }

  revalidatePath("/financiero/gastos");
  revalidatePath("/financiero");
  return { ok: true };
}

// ─── toggleActive (soft delete / restore) ────────────────────────────────

export async function toggleExpenseCategoryActive(
  categoryId: string,
  nextActive: boolean,
): Promise<ToggleCategoryResult> {
  await requireRole("superadmin");

  if (!categoryId) return { error: "Falta el id de la categoría." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("expense_categories")
    .update({ is_active: nextActive } as never)
    .eq("id", categoryId);

  if (error) {
    return { error: error.message ?? "Error cambiando el estado." };
  }

  revalidatePath("/financiero/gastos");
  revalidatePath("/financiero");
  return { ok: true };
}
