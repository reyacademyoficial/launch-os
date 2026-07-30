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

/**
 * Todos los métodos de pago que el usuario ve por RLS (todos los proyectos
 * accesibles). Superadmin ve todos. Usado por la pantalla de saldos de
 * bancos en Kingrow — un banco puede recibir cobros de métodos de múltiples
 * proyectos, así que necesitamos el universo completo para computar bien
 * el `fromPayments` de cada banco.
 */
export async function listAllPaymentMethods(): Promise<PaymentMethodRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payment_methods")
    .select("*")
    .order("active", { ascending: false })
    .order("name", { ascending: true });
  return (data ?? []) as unknown as PaymentMethodRow[];
}
