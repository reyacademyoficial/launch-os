import { createClient } from "@/lib/supabase/server";
import type { ProductRow } from "@/lib/products/types";

/**
 * Lista los productos del proyecto. Activos primero (así el selector del
 * modal de venta los muestra arriba), y alfabéticamente dentro de cada grupo.
 * Mismo criterio que `listPaymentModalities`.
 */
export async function listProductsForProject(
  projectId: string,
): Promise<ProductRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select("*")
    .eq("project_id", projectId)
    .order("active", { ascending: false })
    .order("name", { ascending: true });

  return (data ?? []) as unknown as ProductRow[];
}

/**
 * Todos los productos accesibles al usuario por RLS (todos los proyectos
 * visibles). Superadmin ve todos. Consumido por `/comercial/productos`
 * que administra el catálogo cross-proyecto.
 */
export async function listAllProducts(): Promise<ProductRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select("*")
    .order("active", { ascending: false })
    .order("name", { ascending: true });
  return (data ?? []) as unknown as ProductRow[];
}
