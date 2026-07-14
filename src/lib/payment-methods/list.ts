import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { PaymentMethodRow } from "./types";

/**
 * Lista los métodos de pago del proyecto. Mismo orden que products/
 * modalidades: activos primero, alfabéticamente dentro de cada grupo.
 */
export async function listPaymentMethods(
  projectId: string,
): Promise<PaymentMethodRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payment_methods")
    .select("*")
    .eq("project_id", projectId)
    .order("active", { ascending: false })
    .order("name", { ascending: true });

  return (data ?? []) as unknown as PaymentMethodRow[];
}
