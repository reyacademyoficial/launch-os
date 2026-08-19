import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { PaymentMethodRow } from "./types";

/**
 * Lista todos los métodos de pago visibles por RLS. Post 0134 el catálogo es
 * org-scope: cualquier proyecto de la org ve el mismo listado (mismo criterio
 * que banks post 0101). Orden: activos primero, alfabético dentro de cada
 * grupo — igual que products / modalidades.
 */
export async function listPaymentMethods(): Promise<PaymentMethodRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payment_methods")
    .select("*")
    .order("active", { ascending: false })
    .order("name", { ascending: true });

  return (data ?? []) as unknown as PaymentMethodRow[];
}
