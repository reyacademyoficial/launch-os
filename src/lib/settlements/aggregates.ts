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
 *
 * SPLIT POR CANAL (post mig 0170)
 *   `collectedTotal` se parte según a qué tipo de banco rutea el método de
 *   pago de cada payment:
 *     · método sin bank_id (efectivo, etc.)              → collectedByMe
 *     · bank.is_external_collector = false               → collectedByMe
 *     · bank.is_external_collector = true Y
 *       bank.external_project_id = projectId del launch  → collectedByClientExternal
 *     · bank.is_external_collector = true PERO
 *       external_project_id ≠ projectId del launch       → collectedByMe (fallback
 *       conservador: un banco externo mal ruteado a otro proyecto NO cuenta como
 *       "el cliente ya lo tiene" — mejor forzar la transferencia)
 *     · payment sin payment_method_id (histórico)        → collectedByMe (default
 *       seguro: sin info, asumimos canal propio)
 *
 * Invariante enforced runtime: collectedByMe + collectedByClientExternal ≈ collectedTotal.
 * El CHECK de la DB (0170) rechaza el insert si esta invariante no se cumple —
 * hacemos el chequeo acá para fallar antes con un mensaje claro.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// `settlement_rules`, `launches`, `launch_settlements`, `sales` y `payments`
// no están en el Database generado (algunas se agregaron después del último
// gen). Casteamos al borde igual que create.ts.
type AnySupabase = SupabaseClient<any, any, any>;

export interface LaunchAggregates {
  /** Σ payments.amount de las sales del launch. Fuente ÚNICA de "cuánto cobró". */
  readonly collectedTotal: number;
  /**
   * Σ payments que entraron por MIS bancos (o sin método/banco resoluble).
   * Incluye el fallback de bancos externos con external_project_id que no
   * matchea el projectId del launch.
   */
  readonly collectedByMe: number;
  /**
   * Σ payments cuyo método rutea a un banco is_external_collector=true del
   * MISMO projectId del launch.
   */
  readonly collectedByClientExternal: number;
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
  payment_method_id: string | null;
}

interface PaymentMethodRow {
  id: string;
  bank_id: string | null;
}

interface BankRow {
  id: string;
  is_external_collector: boolean;
  external_project_id: string | null;
}

export async function computeLaunchAggregates(
  supabase: AnySupabase,
  launchId: string,
  projectId?: string,
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
    return {
      collectedTotal: 0,
      collectedByMe: 0,
      collectedByClientExternal: 0,
      totalSold: 0,
      salesCount: 0,
    };
  }

  const saleIds = salesRows.map((s) => s.id);
  const paymentsRes = await supabase
    .from("payments")
    .select("amount, payment_method_id")
    .in("sale_id", saleIds);

  const paymentRows = (paymentsRes.data ?? []) as unknown as PaymentRow[];
  const collectedTotal = paymentRows.reduce(
    (acc, p) => acc + Number(p.amount ?? 0),
    0,
  );

  // ─── Split por canal ─────────────────────────────────────────────────
  // Resolvemos método → bank en dos lookups (methods y banks) para
  // clasificar cada payment. Sin projectId no podemos discriminar bancos
  // externos que pertenezcan a OTRO proyecto (fallback conservador — todo
  // cae en collectedByMe).
  const methodIds = Array.from(
    new Set(
      paymentRows
        .map((p) => p.payment_method_id)
        .filter((id): id is string => !!id),
    ),
  );

  const methodsById = new Map<string, PaymentMethodRow>();
  const banksById = new Map<string, BankRow>();

  if (methodIds.length > 0) {
    const methodsRes = await supabase
      .from("payment_methods")
      .select("id, bank_id")
      .in("id", methodIds);
    const methodRows = (methodsRes.data ?? []) as unknown as PaymentMethodRow[];
    for (const m of methodRows) methodsById.set(m.id, m);

    const bankIds = Array.from(
      new Set(
        methodRows
          .map((m) => m.bank_id)
          .filter((id): id is string => !!id),
      ),
    );

    if (bankIds.length > 0) {
      const banksRes = await supabase
        .from("banks")
        .select("id, is_external_collector, external_project_id")
        .in("id", bankIds);
      const bankRows = (banksRes.data ?? []) as unknown as BankRow[];
      for (const b of bankRows) banksById.set(b.id, b);
    }
  }

  let collectedByMe = 0;
  let collectedByClientExternal = 0;

  for (const p of paymentRows) {
    const amount = Number(p.amount ?? 0);
    if (!p.payment_method_id) {
      collectedByMe += amount;
      continue;
    }
    const method = methodsById.get(p.payment_method_id);
    if (!method || !method.bank_id) {
      collectedByMe += amount;
      continue;
    }
    const bank = banksById.get(method.bank_id);
    if (!bank || !bank.is_external_collector) {
      collectedByMe += amount;
      continue;
    }
    // Banco externo: solo cuenta como "cliente cobró" si coincide con
    // el projectId del launch. Sin projectId → fallback conservador.
    if (projectId && bank.external_project_id === projectId) {
      collectedByClientExternal += amount;
    } else {
      collectedByMe += amount;
    }
  }

  // Safety net: la suma DEBE coincidir con collectedTotal. El CHECK de
  // 0170 rechazaría el insert; fallamos acá con más contexto.
  const sum = collectedByMe + collectedByClientExternal;
  if (Math.abs(sum - collectedTotal) > 0.01) {
    throw new Error(
      `computeLaunchAggregates: split por canal no cierra. ` +
        `collectedTotal=${collectedTotal}, ` +
        `collectedByMe=${collectedByMe}, ` +
        `collectedByClientExternal=${collectedByClientExternal}, ` +
        `suma=${sum}`,
    );
  }

  return {
    collectedTotal,
    collectedByMe,
    collectedByClientExternal,
    totalSold,
    salesCount,
  };
}
