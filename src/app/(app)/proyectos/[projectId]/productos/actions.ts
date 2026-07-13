"use server";

import { revalidatePath } from "next/cache";

import { requireCanEditProject } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export type ProductActionState = { ok: true } | { error: string } | null;

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function nullable(value: string): string | null {
  return value === "" ? null : value;
}

/**
 * Cataloga un producto vendible del proyecto. Espejo estructural de
 * `createPaymentModality`: sólo admin, sin precio (el monto va en la venta).
 *
 * `description` es opcional; `active` arranca en true (visible en el selector
 * al cargar ventas). Se desactiva desde `updateProduct`.
 *
 * Revalidamos también `/leads` y las tabs de cobros porque bajan el catálogo
 * al modal de venta y al filtro — un producto recién creado tiene que
 * aparecer sin refresh manual.
 */
export async function createProduct(
  projectId: string,
  _prev: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  await requireCanEditProject(projectId);
  const name = str(formData, "name");
  if (!name) return { error: "El nombre es obligatorio." };
  const description = nullable(str(formData, "description"));

  const supabase = await createClient();
  const payload = {
    project_id: projectId,
    name,
    description,
    active: true,
  } as never;
  const { error } = await supabase.from("products").insert(payload);
  if (error) {
    if (error.code === "23505") {
      return { error: "Ya existe un producto con ese nombre en el proyecto." };
    }
    return { error: error.message };
  }

  revalidateForProject(projectId);
  return { ok: true };
}

export async function updateProduct(
  projectId: string,
  productId: string,
  _prev: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  await requireCanEditProject(projectId);
  const name = str(formData, "name");
  if (!name) return { error: "El nombre es obligatorio." };
  const description = nullable(str(formData, "description"));
  const active = formData.get("active") !== null;

  const supabase = await createClient();
  const payload = { name, description, active } as never;
  const { error } = await supabase
    .from("products")
    .update(payload)
    .eq("id", productId)
    .eq("project_id", projectId);
  if (error) {
    if (error.code === "23505") {
      return { error: "Ya existe otro producto con ese nombre." };
    }
    return { error: error.message };
  }

  revalidateForProject(projectId);
  return { ok: true };
}

/**
 * Borra un producto del catálogo. Si tiene ventas asociadas, la FK
 * `sales.product_id` con `on delete restrict` (migración 0038) devuelve
 * SQLSTATE 23503 — recomendamos desactivarlo en vez de borrarlo.
 */
export async function deleteProduct(
  projectId: string,
  productId: string,
): Promise<{ ok: true } | { error: string }> {
  await requireCanEditProject(projectId);
  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .delete()
    .eq("id", productId)
    .eq("project_id", projectId);
  if (error) {
    if (error.code === "23503") {
      return {
        error:
          "El producto tiene ventas asociadas. Desactivalo en vez de borrarlo para preservar el histórico.",
      };
    }
    return { error: error.message };
  }
  revalidateForProject(projectId);
  return { ok: true };
}

function revalidateForProject(projectId: string): void {
  revalidatePath(`/proyectos/${projectId}/productos`);
  // El selector de producto vive dentro del modal de venta (kanban de leads
  // y tab de cobros). Un producto nuevo o desactivado tiene que reflejarse
  // sin que el operador tenga que refrescar manualmente.
  revalidatePath(`/proyectos/${projectId}/leads`);
  revalidatePath(`/proyectos/${projectId}/launches`, "layout");
}
