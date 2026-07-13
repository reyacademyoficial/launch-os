"use server";

import { revalidatePath } from "next/cache";

import { findApplicableRule } from "@/lib/commissions/calc";
import { listCommissionRules } from "@/lib/commissions/list";
import { ruleToSnapshot } from "@/lib/commissions/snapshot";
import { resolveSnapshotForSale } from "@/lib/commissions/snapshot";
import { requireCanEditLaunchesIn } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export type SaleActionState = { ok: true; saleId?: string } | { error: string } | null;

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function nullable(value: string): string | null {
  return value === "" ? null : value;
}

/**
 * Crea una sale para un lead. El lead pasa automáticamente a status='cerrado'
 * (la venta es la confirmación del cierre). El brief dice "una venta cuelga
 * de un lead cerrado": elegimos cerrarlo nosotros al crear la venta, en lugar
 * de exigir que el usuario lo mueva antes — UX más directa.
 *
 * ATRIBUCIÓN: la sale hereda `team_member_id` del lead. Es denormalización,
 * NO input del operador. El formulario perdió el dropdown de closer (era
 * editable y generaba drift). Si el dueño del lead cambia, `updateLead`
 * re-sincroniza las sales del lead.
 */
export async function createSale(
  projectId: string,
  leadId: string,
  _prev: SaleActionState,
  formData: FormData,
): Promise<SaleActionState> {
  await requireCanEditLaunchesIn(projectId);

  const payment_modality_id = str(formData, "payment_modality_id");
  if (!payment_modality_id) return { error: "Elegí una modalidad." };

  const product_id = str(formData, "product_id");
  if (!product_id) return { error: "Elegí un producto." };

  const totalRaw = str(formData, "total_amount");
  const total_amount = parseFloat(totalRaw);
  if (!Number.isFinite(total_amount) || total_amount < 0) {
    return { error: "Monto pactado inválido." };
  }

  const closedAtRaw = str(formData, "closed_at");
  const closed_at = closedAtRaw === "" ? new Date().toISOString() : closedAtRaw;

  const supabase = await createClient();

  // Resolver project_id + dueño del lead + launch. El team_member_id de la
  // venta SE DERIVA del lead — el form no lo manda. `launch_id` del lead
  // también es la atribución de launch de la venta (hasta Fase 8 que le da
  // columna propia a sales.launch_id).
  const { data: leadData } = await supabase
    .from("leads")
    .select("project_id, team_member_id, launch_id")
    .eq("id", leadId)
    .maybeSingle();
  const lead = leadData as {
    project_id: string;
    team_member_id: string | null;
    launch_id: string | null;
  } | null;
  if (!lead || lead.project_id !== projectId) {
    return { error: "Lead inexistente o de otro proyecto." };
  }

  // Guard: el producto tiene que ser del mismo proyecto. La RLS lo cubre,
  // pero devolver el error acá es más claro que un 42501 de Postgres.
  const { data: productData } = await supabase
    .from("products")
    .select("id")
    .eq("id", product_id)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!productData) {
    return { error: "Producto inexistente o de otro proyecto." };
  }

  // Congelar la regla al momento del cierre. Fase 7: la comisión histórica
  // no cambia si el admin toca la regla más adelante.
  const snapshot = await resolveSnapshotForSale(
    projectId,
    payment_modality_id,
    lead.launch_id,
    product_id,
  );
  if (!snapshot) {
    return {
      error:
        "No hay comisión configurada para esa combinación de producto y modalidad. Pedile al admin que la cargue en Comisiones.",
    };
  }

  const insertPayload = {
    project_id: projectId,
    lead_id: leadId,
    launch_id: lead.launch_id,
    team_member_id: lead.team_member_id,
    payment_modality_id,
    product_id,
    total_amount,
    closed_at,
    commission_rule_snapshot: snapshot,
  } as never;

  const { data, error } = await supabase
    .from("sales")
    .insert(insertPayload)
    .select("id")
    .maybeSingle();

  if (error) {
    return { error: error.message };
  }

  // Marcar lead cerrado (puede que ya lo esté; es idempotente).
  const leadUpdate = { status: "cerrado" } as never;
  await supabase
    .from("leads")
    .update(leadUpdate)
    .eq("id", leadId)
    .eq("project_id", projectId);

  revalidatePath(`/proyectos/${projectId}/leads`);
  const saleId = (data as { id: string } | null)?.id;
  return { ok: true, saleId };
}

/**
 * Edita una venta: producto, modalidad, monto pactado, fecha de cierre.
 * NO cambia `launch_id` (para eso el operador crea nueva venta) ni
 * `team_member_id` (se hereda del lead, denormalización mantenida por
 * updateLead).
 *
 * SNAPSHOT DE COMISIÓN — política Fase 7:
 *   - Por default NO regenera el snapshot. La comisión histórica queda
 *     congelada con la regla que había al cierre original.
 *   - Si `regenerate=true` (checkbox del form), se resuelve la regla
 *     vigente para la nueva combinación (modality + product) y se
 *     sobrescribe. Útil cuando el operador está corrigiendo un error de
 *     carga y quiere que la comisión refleje el estado correcto.
 */
export async function updateSale(
  projectId: string,
  saleId: string,
  _prev: SaleActionState,
  formData: FormData,
): Promise<SaleActionState> {
  await requireCanEditLaunchesIn(projectId);

  const payment_modality_id = str(formData, "payment_modality_id");
  if (!payment_modality_id) return { error: "Elegí una modalidad." };

  const product_id = str(formData, "product_id");
  if (!product_id) return { error: "Elegí un producto." };

  const totalRaw = str(formData, "total_amount");
  const total_amount = parseFloat(totalRaw);
  if (!Number.isFinite(total_amount) || total_amount < 0) {
    return { error: "Monto pactado inválido." };
  }
  const closedAtRaw = str(formData, "closed_at");
  const regenerate = formData.get("regenerate") !== null;

  const supabase = await createClient();

  // Guard de pertenencia — mismo criterio que createSale.
  const { data: productData } = await supabase
    .from("products")
    .select("id")
    .eq("id", product_id)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!productData) {
    return { error: "Producto inexistente o de otro proyecto." };
  }

  // El dueño de la venta es el del lead — no se recibe del form. Mantenerlo
  // alineado preserva el invariante que el LB y el PDF asumen. También
  // necesitamos launch_id para regenerar el snapshot si aplica.
  const { data: saleRow } = await supabase
    .from("sales")
    .select("lead_id, launch_id")
    .eq("id", saleId)
    .eq("project_id", projectId)
    .maybeSingle();
  const saleRef = saleRow as {
    lead_id: string;
    launch_id: string | null;
  } | null;
  if (!saleRef) return { error: "Venta inexistente." };
  const { data: leadRow } = await supabase
    .from("leads")
    .select("team_member_id")
    .eq("id", saleRef.lead_id)
    .maybeSingle();
  const team_member_id =
    (leadRow as { team_member_id: string | null } | null)?.team_member_id ?? null;

  let snapshotUpdate: Record<string, unknown> = {};
  if (regenerate) {
    const snapshot = await resolveSnapshotForSale(
      projectId,
      payment_modality_id,
      saleRef.launch_id,
      product_id,
    );
    if (!snapshot) {
      return {
        error:
          "No hay comisión configurada para esa combinación de producto y modalidad. Cargala antes de regenerar.",
      };
    }
    snapshotUpdate = { commission_rule_snapshot: snapshot };
  }

  const payload = {
    payment_modality_id,
    product_id,
    total_amount,
    team_member_id,
    ...(closedAtRaw && { closed_at: closedAtRaw }),
    ...snapshotUpdate,
  } as never;

  const { error } = await supabase
    .from("sales")
    .update(payload)
    .eq("id", saleId)
    .eq("project_id", projectId);
  if (error) return { error: error.message };

  await revalidateForSale(projectId, saleId);
  return { ok: true };
}

/**
 * Cambia el producto de una venta sin tocar el resto (modalidad, monto,
 * cobros). Pensado para reasignar producto desde la vista de cobros —
 * frecuente cuando el operador cargó una venta con "Sin categoría" y
 * ahora quiere migrarla al catálogo real.
 *
 * Guard de pertenencia: el producto tiene que ser del mismo proyecto.
 *
 * SNAPSHOT: por default la comisión queda congelada con la regla del
 * producto ANTERIOR (política Fase 7 "regla al cierre"). Si `regenerate`
 * es true, resolvemos la regla actual del nuevo producto y sobrescribimos
 * el snapshot — para reasignaciones donde el operador quiere que la
 * comisión también migre.
 */
export async function updateSaleProduct(
  projectId: string,
  saleId: string,
  productId: string,
  regenerate = false,
): Promise<{ ok: true } | { error: string }> {
  await requireCanEditLaunchesIn(projectId);
  if (!productId) return { error: "Elegí un producto." };

  const supabase = await createClient();

  const { data: productData } = await supabase
    .from("products")
    .select("id")
    .eq("id", productId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!productData) {
    return { error: "Producto inexistente o de otro proyecto." };
  }

  let snapshotUpdate: Record<string, unknown> = {};
  if (regenerate) {
    // Fase 8: `sale.launch_id` es la atribución propia de la venta.
    const { data: saleData } = await supabase
      .from("sales")
      .select("payment_modality_id, launch_id")
      .eq("id", saleId)
      .eq("project_id", projectId)
      .maybeSingle();
    const sale = saleData as {
      payment_modality_id: string;
      launch_id: string | null;
    } | null;
    if (!sale) return { error: "Venta inexistente." };

    const snapshot = await resolveSnapshotForSale(
      projectId,
      sale.payment_modality_id,
      sale.launch_id,
      productId,
    );
    if (!snapshot) {
      return {
        error:
          "No hay comisión configurada para el nuevo producto en esa modalidad. Cargala antes de reasignar.",
      };
    }
    snapshotUpdate = { commission_rule_snapshot: snapshot };
  }

  const payload = { product_id: productId, ...snapshotUpdate } as never;
  const { error } = await supabase
    .from("sales")
    .update(payload)
    .eq("id", saleId)
    .eq("project_id", projectId);
  if (error) return { error: error.message };

  await revalidateForSale(projectId, saleId);
  return { ok: true };
}

/**
 * Recalcula el `commission_rule_snapshot` de una venta contra la regla
 * vigente en el proyecto. Overwrite explícito — pensado para el botón
 * "Recalcular comisión con la regla actual" del SalePanel.
 */
export async function recalculateSaleCommission(
  projectId: string,
  saleId: string,
): Promise<{ ok: true } | { error: string }> {
  await requireCanEditLaunchesIn(projectId);
  const supabase = await createClient();

  const { data: saleData } = await supabase
    .from("sales")
    .select("payment_modality_id, product_id, launch_id")
    .eq("id", saleId)
    .eq("project_id", projectId)
    .maybeSingle();
  const sale = saleData as {
    payment_modality_id: string;
    product_id: string;
    launch_id: string | null;
  } | null;
  if (!sale) return { error: "Venta inexistente." };

  const snapshot = await resolveSnapshotForSale(
    projectId,
    sale.payment_modality_id,
    sale.launch_id,
    sale.product_id,
  );
  if (!snapshot) {
    return {
      error:
        "No hay comisión configurada para esa combinación de producto y modalidad.",
    };
  }

  const payload = { commission_rule_snapshot: snapshot } as never;
  const { error } = await supabase
    .from("sales")
    .update(payload)
    .eq("id", saleId)
    .eq("project_id", projectId);
  if (error) return { error: error.message };

  await revalidateForSale(projectId, saleId);
  return { ok: true };
}

/**
 * Borra una sale. Los payments asociados caen por CASCADE (FK definida en
 * 0014). El lead NO se borra ni cambia de columna — el card del kanban queda
 * en `cerrado` sin venta, listo para que el usuario lo mueva a otra columna
 * si quiere. Decisión explícita: simétrico con "deletePayment no des-cierra
 * la venta", evita adivinar a qué estado revertir.
 *
 * Revalidamos también el launch detail (cobros/KPI) si el lead estaba ligado
 * a un launch — para que el revenue agregado se refleje al instante en lugar
 * de quedar con cache stale del SSR previo.
 */
export async function deleteSale(projectId: string, saleId: string): Promise<void> {
  await requireCanEditLaunchesIn(projectId);
  const supabase = await createClient();

  // Lookup del launch_id antes de borrar, para revalidar la tab de cobros.
  // Fase 8: la sale tiene su propio launch_id.
  const { data: saleRow } = await supabase
    .from("sales")
    .select("launch_id")
    .eq("id", saleId)
    .eq("project_id", projectId)
    .maybeSingle();
  const launchId =
    (saleRow as { launch_id: string | null } | null)?.launch_id ?? null;

  await supabase
    .from("sales")
    .delete()
    .eq("id", saleId)
    .eq("project_id", projectId);

  revalidatePath(`/proyectos/${projectId}/leads`);
  if (launchId) {
    revalidatePath(`/proyectos/${projectId}/launches/${launchId}`);
    revalidatePath(`/proyectos/${projectId}/launches/${launchId}/cobros`);
    revalidatePath(`/proyectos/${projectId}/launches/${launchId}/kpi`);
  }
}

// ─── payments ─────────────────────────────────────────────────────────────

export type PaymentActionState = { ok: true } | { error: string } | null;

/**
 * Revalida las rutas que dependen del par (sale, launch): kanban de leads,
 * tab de cobros y KPI del launch. Si la sale no está atada a un launch,
 * revalida sólo /leads. Mismo patrón que `deleteSale`.
 */
async function revalidateForSale(
  projectId: string,
  saleId: string,
): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sales")
    .select("launch_id")
    .eq("id", saleId)
    .eq("project_id", projectId)
    .maybeSingle();
  const launchId =
    (data as { launch_id: string | null } | null)?.launch_id ?? null;

  revalidatePath(`/proyectos/${projectId}/leads`);
  if (launchId) {
    revalidatePath(`/proyectos/${projectId}/launches/${launchId}`);
    revalidatePath(`/proyectos/${projectId}/launches/${launchId}/cobros`);
    revalidatePath(`/proyectos/${projectId}/launches/${launchId}/kpi`);
  }
}

export async function addPayment(
  projectId: string,
  saleId: string,
  _prev: PaymentActionState,
  formData: FormData,
): Promise<PaymentActionState> {
  await requireCanEditLaunchesIn(projectId);

  const amountRaw = str(formData, "amount");
  const amount = parseFloat(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "El monto debe ser mayor a 0." };
  }
  const paidAt = str(formData, "paid_at");
  const notes = nullable(str(formData, "notes"));

  const supabase = await createClient();
  const payload = {
    sale_id: saleId,
    amount,
    ...(paidAt && { paid_at: paidAt }),
    notes,
  } as never;

  const { error } = await supabase.from("payments").insert(payload);
  if (error) return { error: error.message };

  await revalidateForSale(projectId, saleId);
  return { ok: true };
}

export async function deletePayment(
  projectId: string,
  paymentId: string,
): Promise<void> {
  await requireCanEditLaunchesIn(projectId);
  const supabase = await createClient();
  // Lookup del sale_id antes de borrar para poder revalidar la tab de cobros.
  const { data: paymentRow } = await supabase
    .from("payments")
    .select("sale_id")
    .eq("id", paymentId)
    .maybeSingle();
  const saleId = (paymentRow as { sale_id: string } | null)?.sale_id ?? null;

  await supabase.from("payments").delete().eq("id", paymentId);

  if (saleId) {
    await revalidateForSale(projectId, saleId);
  } else {
    revalidatePath(`/proyectos/${projectId}/leads`);
  }
}

// ─── recalculo bulk (Fase 9) ─────────────────────────────────────────────

export interface RecalculateBulkFilters {
  /** Restringe a ventas con este launch_id. NULL/undefined = todos los launches. */
  launchId?: string | null;
  /** Restringe a ventas con este product_id. NULL/undefined = todos los productos. */
  productId?: string | null;
  /**
   * pending: sólo ventas con saldo pendiente (`sum(payments) < total_amount`).
   * all: todas las ventas del scope (incluye ya totalmente cobradas).
   */
  scope: "pending" | "all";
}

export interface RecalculateBulkPreview {
  totalMatches: number;
}

export interface RecalculateBulkResult {
  updated: number;
  failed: number;
  firstError?: string;
}

interface SaleForBulk {
  id: string;
  payment_modality_id: string;
  product_id: string;
  launch_id: string | null;
  total_amount: number;
}

/**
 * Filtra sales según los criterios de bulk. Reusa RLS via cliente autenticado.
 * scope="pending" hace un lookup adicional a payments para calcular el
 * pendiente por venta. `all` no necesita ese join.
 */
async function fetchSalesForBulk(
  projectId: string,
  filters: RecalculateBulkFilters,
): Promise<SaleForBulk[]> {
  const supabase = await createClient();
  let query = supabase
    .from("sales")
    .select("id, payment_modality_id, product_id, launch_id, total_amount")
    .eq("project_id", projectId);

  if (filters.launchId) query = query.eq("launch_id", filters.launchId);
  if (filters.productId) query = query.eq("product_id", filters.productId);

  const { data: rows } = await query;
  const sales = (rows ?? []) as unknown as Array<SaleForBulk>;
  if (sales.length === 0) return [];

  if (filters.scope === "all") return sales;

  // scope="pending": traer payments agregados y filtrar los saldos.
  const saleIds = sales.map((s) => s.id);
  const { data: paymentRows } = await supabase
    .from("payments")
    .select("sale_id, amount")
    .in("sale_id", saleIds);
  const payments = (paymentRows ?? []) as unknown as Array<{
    sale_id: string;
    amount: number;
  }>;
  const collectedBySale = new Map<string, number>();
  for (const p of payments) {
    const cur = collectedBySale.get(p.sale_id) ?? 0;
    collectedBySale.set(p.sale_id, cur + Number(p.amount));
  }
  return sales.filter((s) => {
    const collected = collectedBySale.get(s.id) ?? 0;
    return collected < Number(s.total_amount);
  });
}

/**
 * Preview del count antes de disparar el recalc — el modal lo llama al
 * abrirse y cada vez que cambian los filtros/scope.
 */
export async function previewRecalculateCommissionsBulk(
  projectId: string,
  filters: RecalculateBulkFilters,
): Promise<RecalculateBulkPreview | { error: string }> {
  await requireCanEditLaunchesIn(projectId);
  try {
    const sales = await fetchSalesForBulk(projectId, filters);
    return { totalMatches: sales.length };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Recalcula el `commission_rule_snapshot` de todas las ventas que matchean
 * los filtros contra la regla vigente HOY. Mismo criterio de matching que
 * `findApplicableRule` (cascada Fase 7: producto → launch → default).
 *
 * Ventas cuya combinación no tiene regla vigente se saltan y cuentan como
 * `failed`. El primer error se reporta en `firstError` — el resto se
 * agrega al contador.
 *
 * NO usa `recalculateSaleCommission` para cada venta (que refetchea la
 * regla) — resuelve las reglas una sola vez y reusa el map, ahorrando N
 * roundtrips.
 */
export async function recalculateCommissionsBulk(
  projectId: string,
  filters: RecalculateBulkFilters,
): Promise<RecalculateBulkResult | { error: string }> {
  await requireCanEditLaunchesIn(projectId);
  const supabase = await createClient();

  const sales = await fetchSalesForBulk(projectId, filters);
  if (sales.length === 0) {
    return { updated: 0, failed: 0 };
  }

  // Resolver reglas UNA sola vez.
  const rules = await listCommissionRules(projectId);

  const results = await Promise.allSettled(
    sales.map(async (s) => {
      const rule = findApplicableRule(
        rules,
        s.payment_modality_id,
        s.launch_id,
        s.product_id,
      );
      if (!rule) {
        throw new Error(
          "No hay comisión configurada para esa combinación de producto y modalidad.",
        );
      }
      const snapshot = ruleToSnapshot(rule);
      const payload = { commission_rule_snapshot: snapshot } as never;
      const { error } = await supabase
        .from("sales")
        .update(payload)
        .eq("id", s.id)
        .eq("project_id", projectId);
      if (error) throw new Error(error.message);
    }),
  );

  let updated = 0;
  let failed = 0;
  let firstError: string | undefined;
  for (const r of results) {
    if (r.status === "fulfilled") {
      updated++;
    } else {
      failed++;
      firstError ??= (r.reason as Error).message;
    }
  }

  // Revalidamos la cache. Preferimos ir directo a los paths afectados que a
  // /leads global — hoy revalido el layout de launches para cubrir tanto
  // /launches/[id] como /launches/[id]/cobros, más /leads porque el kanban
  // también depende del snapshot para preview de comisión.
  revalidatePath(`/proyectos/${projectId}/leads`);
  revalidatePath(`/proyectos/${projectId}/launches`, "layout");

  return { updated, failed, firstError };
}
