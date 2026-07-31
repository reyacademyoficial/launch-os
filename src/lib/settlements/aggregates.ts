/**
 * Agregados por lanzamiento para el motor de liquidaciones.
 *
 * ÚNICA fuente. Antes había dos implementaciones idénticas de este cálculo:
 * una en `create.ts` (para el orquestador que persiste liquidaciones) y otra
 * en `reglas-split/actions.ts` (para el simulador de la UI). Duplicar la
 * lógica invita a que se divergen — el simulador mostraría un número y la
 * liquidación real escribiría otro. Ahora ambos consumen esta función.
 *
 * REGLA DE ORO heredada de calc.ts: dos subqueries INDEPENDIENTES sobre
 * `sales` y `payments`. Un join `sales × payments` multiplica cada venta por
 * su cantidad de pagos y rompe `totalSold`. Ese bug está cubierto en
 * `create.test.ts` (fan-out prevention) y se replica acá.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// `settlement_rules`, `launches`, `launch_settlements`, `sales` y `payments`
// no están en el Database generado (algunas se agregaron después del último
// gen). Casteamos al borde igual que create.ts.
type AnySupabase = SupabaseClient<any, any, any>;

export interface LaunchAggregates {
  /** Σ payments.amount de las sales del launch. Fuente ÚNICA de "cuánto cobró". */
  readonly collectedTotal: number;
  /** Σ sales.total_amount del launch. Solo usado si applies_on='sold'. */
  readonly totalSold: number;
  /** Cantidad de sales del launch. Usado por fixed_fee_per_sale. */
  readonly salesCount: number;
}

interface SaleRow {
  id: string;
  total_amount: number;
}

interface PaymentRow {
  amount: number;
}

export async function computeLaunchAggregates(
  supabase: AnySupabase,
  launchId: string,
): Promise<LaunchAggregates> {
  const salesRes = await supabase
    .from("sales")
    .select("id, total_amount")
    .eq("launch_id", launchId);

  const salesRows = (salesRes.data ?? []) as unknown as SaleRow[];
  const salesCount = salesRows.length;
  const totalSold = salesRows.reduce(
    (acc, s) => acc + Number(s.total_amount ?? 0),
    0,
  );

  if (salesRows.length === 0) {
    return { collectedTotal: 0, totalSold: 0, salesCount: 0 };
  }

  const saleIds = salesRows.map((s) => s.id);
  const paymentsRes = await supabase
    .from("payments")
    .select("amount")
    .in("sale_id", saleIds);

  const paymentRows = (paymentsRes.data ?? []) as unknown as PaymentRow[];
  const collectedTotal = paymentRows.reduce(
    (acc, p) => acc + Number(p.amount ?? 0),
    0,
  );

  return { collectedTotal, totalSold, salesCount };
}
