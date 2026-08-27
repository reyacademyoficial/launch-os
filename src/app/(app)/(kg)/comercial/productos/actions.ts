"use server";

import { revalidatePath, updateTag } from "next/cache";

import { currentOrgTagsAcademia } from "@/lib/academia/reference";
import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

import { translateProductError } from "./translate-error";

async function bustProductsCache(): Promise<void> {
  // Academia consume products como referencia. Cualquier alta/edición/baja
  // desde Comercial tiene que reflejarse en los dropdowns de Academia.
  const tags = await currentOrgTagsAcademia();
  if (tags) updateTag(tags.products);
}

// ═══════════════════════════════════════════════════════════════════════════
// Server actions para products desde Kingrow — org-wide con selector de
// proyecto en el drawer. Schema sigue project-scope (0038); RLS lo mismo.
// Superadmin ve/edita todos.
//
// Sin cambios funcionales respecto a los actions de LaunchOS que sustituye
// — mismos validators, mismos mensajes de error, misma política de delete
// (permitido si no hay sales; DB rechaza con RESTRICT).
// ═══════════════════════════════════════════════════════════════════════════

export type CreateProductState =
  | { ok: true; productId: string }
  | { error: string }
  | null;

export type UpdateProductState = { ok: true } | { error: string } | null;

export type SetProductActiveResult = { ok: true } | { error: string };

export type DeleteProductResult = { ok: true } | { error: string };

interface ProductPayload {
  readonly projectId: string;
  readonly name: string;
  readonly description: string | null;
}

function parseFormData(formData: FormData): ProductPayload | string {
  const projectId = String(formData.get("project_id") ?? "").trim();
  if (projectId.length === 0) return "Elegí un proyecto.";

  const name = String(formData.get("name") ?? "").trim();
  if (name.length === 0) return "El nombre del producto es obligatorio.";

  const descRaw = String(formData.get("description") ?? "").trim();
  const description = descRaw.length === 0 ? null : descRaw;

  return { projectId, name, description };
}

async function revalidateCommon(projectId: string) {
  await bustProductsCache();
  revalidatePath("/comercial/productos");
  // Selector de producto en el sale-modal (LaunchOS): tab de leads + tab de
  // cobros + layout de launches. Un producto recién creado / desactivado
  // tiene que reflejarse sin refresh manual.
  revalidatePath(`/proyectos/${projectId}/leads`);
  revalidatePath(`/proyectos/${projectId}/cobros`);
  revalidatePath(`/proyectos/${projectId}/ventas`);
  revalidatePath(`/proyectos/${projectId}/launches`, "layout");
}

// ═══════════════════════════════════════════════════════════════════════════
// createProduct
// ═══════════════════════════════════════════════════════════════════════════

export async function createProduct(
  _prev: CreateProductState,
  formData: FormData,
): Promise<CreateProductState> {
  await requireRole("superadmin");

  const parsed = parseFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createClient();
  const payload = {
    project_id: parsed.projectId,
    name: parsed.name,
    description: parsed.description,
    active: true,
  } as never;

  const { data, error } = await supabase
    .from("products")
    .insert(payload)
    .select("id")
    .single();

  if (error) return { error: translateProductError(error) };
  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  await revalidateCommon(parsed.projectId);
  return { ok: true, productId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateProduct — el projectId NO se puede cambiar (rompería sales)
// ═══════════════════════════════════════════════════════════════════════════

export async function updateProduct(
  productId: string,
  _prev: UpdateProductState,
  formData: FormData,
): Promise<UpdateProductState> {
  await requireRole("superadmin");

  const parsed = parseFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createClient();
  const payload = {
    name: parsed.name,
    description: parsed.description,
    // project_id NO se toca — ver comentario del módulo.
  } as never;

  const { error } = await supabase
    .from("products")
    .update(payload)
    .eq("id", productId);

  if (error) return { error: translateProductError(error) };

  await revalidateCommon(parsed.projectId);
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// setProductActive
// ═══════════════════════════════════════════════════════════════════════════

export async function setProductActive(
  productId: string,
  projectId: string,
  active: boolean,
): Promise<SetProductActiveResult> {
  await requireRole("superadmin");

  const supabase = await createClient();
  const payload = { active } as never;

  const { error } = await supabase
    .from("products")
    .update(payload)
    .eq("id", productId);

  if (error) return { error: translateProductError(error) };

  await revalidateCommon(projectId);
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// deleteProduct — permitido si no hay sales (RESTRICT en DB)
// ═══════════════════════════════════════════════════════════════════════════

export async function deleteProduct(
  productId: string,
  projectId: string,
): Promise<DeleteProductResult> {
  await requireRole("superadmin");

  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .delete()
    .eq("id", productId);

  if (error) return { error: translateProductError(error) };

  await revalidateCommon(projectId);
  return { ok: true };
}
