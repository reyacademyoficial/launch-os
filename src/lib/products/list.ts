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
