"use server";

import { revalidatePath } from "next/cache";

import { findApplicableRule } from "@/lib/commissions/calc";
import { listCommissionRules } from "@/lib/commissions/list";
import { ruleToSnapshot } from "@/lib/commissions/snapshot";
import { resolveSnapshotForSale } from "@/lib/commissions/snapshot";
import type { InstallmentFrequency } from "@/lib/commissions/types";
import { requireCanEditLaunchesIn } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Fase 11 — límites sanos para el plan de cuotas. 24 cobre casos típicos
 * (24 cuotas mensuales = 2 años). Más que eso pide justificación aparte.
 */
const MIN_INSTALLMENTS = 1;
const MAX_INSTALLMENTS = 24;
const VALID_FREQUENCIES: readonly InstallmentFrequency[] = [
  "single",
  "weekly",
  "monthly",
];

function parseInstallmentInput(
  formData: FormData,
): { count: number; frequency: InstallmentFrequency; graceDays: number } | { error: string } {
  const countRaw = String(formData.get("installment_count") ?? "1").trim();
  const count = parseInt(countRaw, 10);
  if (!Number.isFinite(count) || count < MIN_INSTALLMENTS || count > MAX_INSTALLMENTS) {
    return {
      error: `Cantidad de cuotas debe estar entre ${MIN_INSTALLMENTS} y ${MAX_INSTALLMENTS}.`,
    };
  }

  const freqRaw = String(formData.get("installment_frequency") ?? "single").trim();
  if (!VALID_FREQUENCIES.includes(freqRaw as InstallmentFrequency)) {
    return { error: "Frecuencia de cuotas inválida." };
  }
  const frequency = freqRaw as InstallmentFrequency;

  // 1 cuota siempre implica frecuencia 'single' — normalizamos para que la
  // DB no reciba combinaciones raras como (count=1, frequency='weekly').
  const normalizedFrequency: InstallmentFrequency = count === 1 ? "single" : frequency;

  const graceRaw = String(formData.get("grace_days") ?? "5").trim();
  const graceDays = parseInt(graceRaw, 10);
  if (!Number.isFinite(graceDays) || graceDays < 0 || graceDays > 90) {
    return { error: "Días de gracia debe estar entre 0 y 90." };
  }

  return { count, frequency: normalizedFrequency, graceDays };
}

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

  // Default ARS si el form no manda el campo (matchea el DEFAULT del schema).
  const currencyRaw = str(formData, "currency");
  const currency = currencyRaw === "USD" ? "USD" : "ARS";

  const closedAtRaw = str(formData, "closed_at");
  const closed_at = closedAtRaw === "" ? new Date().toISOString() : closedAtRaw;

  const installmentInput = parseInstallmentInput(formData);
  if ("error" in installmentInput) return installmentInput;

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
    currency,
    closed_at,
    installment_count: installmentInput.count,
    installment_frequency: installmentInput.frequency,
    grace_days: installmentInput.graceDays,
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

  const saleId = (data as { id: string } | null)?.id;

  // Generar las cuotas via función SQL. Si falla, borramos la venta recién
  // creada para no dejar sales sin plan de cuotas (invariante Fase 11).
  if (saleId) {
    const { error: genError } = await supabase.rpc(
      "generate_installments_for_sale" as never,
      { p_sale_id: saleId } as never,
    );
    if (genError) {
      await supabase.from("sales").delete().eq("id", saleId);
      return { error: `No se pudieron generar las cuotas: ${genError.message}` };
    }

    // Auto-generar facturas (una por cuota). Fallo NO revierte la venta —
    // la venta y sus cuotas quedan intactas; el operador puede volver a
    // regenerar desde /financiero/facturas o al editar la venta. Preferimos
    // que la venta se cree con facturas faltantes que perderla entera.
    await supabase.rpc(
      "generate_invoices_for_sale" as never,
      { p_sale_id: saleId } as never,
    );
  }

  // Marcar lead cerrado (puede que ya lo esté; es idempotente).
  const leadUpdate = { status: "cerrado" } as never;
  await supabase
    .from("leads")
    .update(leadUpdate)
    .eq("id", leadId)
    .eq("project_id", projectId);

  revalidateSalesImpact(projectId, lead.launch_id);
  return { ok: true, saleId };
}

/**
 * Alta de venta desde la vista project-wide de Ventas. Crea el lead y la venta
 * en un mismo paso: el operador viene con la info de la venta ya cerrada y no
 * quiere pasar por el kanban de leads (Fase 12+).
 *
 * El lead se crea con `status='cerrado'` y `source='manual'`. Si la venta falla
 * o la generación de cuotas revienta, se hace rollback manual del lead para no
 * dejar huérfanos.
 *
 * Los campos launch_id / team_member_id son opcionales — se guardan tanto en el
 * lead como en la sale (denormalización habitual). `createSale` hereda del lead;
 * acá los seteamos directo porque el lead se crea acá mismo con esos valores.
 */
export async function createSaleWithLead(
  projectId: string,
  _prev: SaleActionState,
  formData: FormData,
): Promise<SaleActionState> {
  await requireCanEditLaunchesIn(projectId);

  const lead_name = str(formData, "lead_name");
  if (!lead_name) return { error: "Cargá el nombre del alumno." };

  const lead_contact = nullable(str(formData, "lead_contact"));
  const launch_id = nullable(str(formData, "launch_id"));
  const team_member_id = nullable(str(formData, "team_member_id"));

  const payment_modality_id = str(formData, "payment_modality_id");
  if (!payment_modality_id) return { error: "Elegí una modalidad." };

  const product_id = str(formData, "product_id");
  if (!product_id) return { error: "Elegí un producto." };

  const totalRaw = str(formData, "total_amount");
  const total_amount = parseFloat(totalRaw);
  if (!Number.isFinite(total_amount) || total_amount < 0) {
    return { error: "Monto pactado inválido." };
  }

  const currencyRaw = str(formData, "currency");
  const currency = currencyRaw === "USD" ? "USD" : "ARS";

  const closedAtRaw = str(formData, "closed_at");
  const closed_at = closedAtRaw === "" ? new Date().toISOString() : closedAtRaw;

  const installmentInput = parseInstallmentInput(formData);
  if ("error" in installmentInput) return installmentInput;

  const supabase = await createClient();

  const { data: productData } = await supabase
    .from("products")
    .select("id")
    .eq("id", product_id)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!productData) {
    return { error: "Producto inexistente o de otro proyecto." };
  }

  const snapshot = await resolveSnapshotForSale(
    projectId,
    payment_modality_id,
    launch_id,
    product_id,
  );
  if (!snapshot) {
    return {
      error:
        "No hay comisión configurada para esa combinación de producto y modalidad. Pedile al admin que la cargue en Comisiones.",
    };
  }

  const leadInsert = {
    project_id: projectId,
    name: lead_name,
    contact: lead_contact,
    launch_id,
    team_member_id,
    status: "cerrado",
  } as never;
  const { data: leadRow, error: leadErr } = await supabase
    .from("leads")
    .insert(leadInsert)
    .select("id")
    .maybeSingle();
  if (leadErr) return { error: leadErr.message };
  const leadId = (leadRow as { id: string } | null)?.id;
  if (!leadId) return { error: "No se pudo crear el lead." };

  const saleInsert = {
    project_id: projectId,
    lead_id: leadId,
    launch_id,
    team_member_id,
    payment_modality_id,
    product_id,
    total_amount,
    currency,
    closed_at,
    installment_count: installmentInput.count,
    installment_frequency: installmentInput.frequency,
    grace_days: installmentInput.graceDays,
    commission_rule_snapshot: snapshot,
  } as never;

  const { data: saleRow, error: saleErr } = await supabase
    .from("sales")
    .insert(saleInsert)
    .select("id")
    .maybeSingle();
  if (saleErr) {
    await supabase.from("leads").delete().eq("id", leadId);
    return { error: saleErr.message };
  }
  const saleId = (saleRow as { id: string } | null)?.id;

  if (saleId) {
    const { error: genErr } = await supabase.rpc(
      "generate_installments_for_sale" as never,
      { p_sale_id: saleId } as never,
    );
    if (genErr) {
      await supabase.from("sales").delete().eq("id", saleId);
      await supabase.from("leads").delete().eq("id", leadId);
      return {
        error: `No se pudieron generar las cuotas: ${genErr.message}`,
      };
    }

    // Auto-generar facturas — ver comentario en createSale. Fallo no revierte.
    await supabase.rpc(
      "generate_invoices_for_sale" as never,
      { p_sale_id: saleId } as never,
    );
  }

  revalidateSalesImpact(projectId, launch_id);
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
  const currencyRaw = str(formData, "currency");
  const currency = currencyRaw === "USD" ? "USD" : "ARS";
  const closedAtRaw = str(formData, "closed_at");
  const regenerate = formData.get("regenerate") !== null;

  const installmentInput = parseInstallmentInput(formData);
  if ("error" in installmentInput) return installmentInput;

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
  // necesitamos launch_id para regenerar el snapshot si aplica y los
  // campos del plan actual para saber si tocamos cuotas.
  const { data: saleRow } = await supabase
    .from("sales")
    .select(
      "lead_id, launch_id, total_amount, closed_at, installment_count, installment_frequency, grace_days",
    )
    .eq("id", saleId)
    .eq("project_id", projectId)
    .maybeSingle();
  const saleRef = saleRow as {
    lead_id: string;
    launch_id: string | null;
    total_amount: number;
    closed_at: string;
    installment_count: number;
    installment_frequency: InstallmentFrequency;
    grace_days: number;
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
    currency,
    team_member_id,
    installment_count: installmentInput.count,
    installment_frequency: installmentInput.frequency,
    grace_days: installmentInput.graceDays,
    ...(closedAtRaw && { closed_at: closedAtRaw }),
    ...snapshotUpdate,
  } as never;

  const { error } = await supabase
    .from("sales")
    .update(payload)
    .eq("id", saleId)
    .eq("project_id", projectId);
  if (error) return { error: error.message };

  // Regenerar cuotas si CUALQUIER campo del plan cambió (count / frequency /
  // total / closed_at). Grace days no dispara regeneración porque no cambia
  // el cronograma — sólo la clasificación de "vencido". Regenerar deja los
  // payments huérfanos vía `on delete set null`; la ficha del alumno los
  // muestra flotando para re-linkeo manual.
  const planChanged =
    installmentInput.count !== saleRef.installment_count ||
    installmentInput.frequency !== saleRef.installment_frequency ||
    total_amount !== Number(saleRef.total_amount) ||
    (closedAtRaw && closedAtRaw !== saleRef.closed_at.slice(0, 10));

  if (planChanged) {
    const { error: genError } = await supabase.rpc(
      "generate_installments_for_sale" as never,
      { p_sale_id: saleId } as never,
    );
    if (genError) {
      return { error: `No se pudieron regenerar las cuotas: ${genError.message}` };
    }

    // Regenerar facturas junto con las cuotas. La RPC preserva las cobradas
    // y anuladas; sólo regenera las emitidas sin paid_at. Fallo no revierte
    // las cuotas — el operador puede reintentar desde /financiero/facturas.
    await supabase.rpc(
      "generate_invoices_for_sale" as never,
      { p_sale_id: saleId } as never,
    );
  }

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

  revalidateSalesImpact(projectId, launchId);
}

/**
 * Revalida TODAS las rutas cuyo agregado depende de la venta que cambió.
 * Incluye:
 *   - Overview del proyecto (`aggregateProjectKPIs`).
 *   - Listado de launches (mismo aggregate por launch card).
 *   - Kanban de leads.
 *   - Detalle del launch (kpi + cobros) si aplica.
 *
 * Sin esto, los KPIs de overview y del listado quedan con cache stale de la
 * SSR previa aunque el detalle del launch ya haya revalidado — bug reportado
 * el 2026-07-14 tras Fase 8: el detail mostraba bien pero overview seguía
 * con los números viejos.
 */
function revalidateSalesImpact(
  projectId: string,
  launchId: string | null,
): void {
  revalidatePath(`/proyectos/${projectId}`);
  revalidatePath(`/proyectos/${projectId}/launches`);
  revalidatePath(`/proyectos/${projectId}/leads`);
  // Vistas project-wide de ventas y cobros (Fase 12) — sino la fila recién
  // creada no aparece hasta el próximo hard reload.
  revalidatePath(`/proyectos/${projectId}/ventas`);
  revalidatePath(`/proyectos/${projectId}/cobros`);
  // La pestaña "Métodos de pago" en Kingrow muestra totales por método —
  // cualquier alta/edición de cobro cambia esos números. Post 6d-B vive
  // en /financiero/metodos-pago (antes en /proyectos/[id]/metodos-pago).
  revalidatePath("/financiero/metodos-pago");
  revalidatePath("/financiero/bancos");
  if (launchId) {
    revalidatePath(`/proyectos/${projectId}/launches/${launchId}`);
    revalidatePath(`/proyectos/${projectId}/launches/${launchId}/kpi`);
  }
}

// ─── payments ─────────────────────────────────────────────────────────────

export type PaymentActionState = { ok: true } | { error: string } | null;

/**
 * Revalida las rutas que dependen del par (sale, launch). Ver
 * `revalidateSalesImpact` — este wrapper hace el lookup del launch_id antes.
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
  revalidateSalesImpact(projectId, launchId);
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

  const installmentIdRaw = str(formData, "installment_id");
  const installment_id = installmentIdRaw === "" ? null : installmentIdRaw;
  const paymentMethodIdRaw = str(formData, "payment_method_id");
  const payment_method_id = paymentMethodIdRaw === "" ? null : paymentMethodIdRaw;
  const originalCurrencyRaw = str(formData, "original_currency");
  const original_currency =
    originalCurrencyRaw === "ARS" || originalCurrencyRaw === "USD"
      ? originalCurrencyRaw
      : null;
  const transaction_number = nullable(str(formData, "transaction_number"));

  if (!installment_id) {
    return { error: "Elegí a qué cuota se aplica el cobro." };
  }
  if (!payment_method_id) {
    return { error: "Elegí el método de pago." };
  }

  const supabase = await createClient();

  // Guard de integridad: la cuota tiene que ser de esta venta. RLS y la FK
  // ya lo cubren indirectamente, pero un error temprano es más claro que un
  // 23503 de Postgres.
  const { data: instRow } = await supabase
    .from("installments")
    .select("sale_id")
    .eq("id", installment_id)
    .maybeSingle();
  const inst = instRow as { sale_id: string } | null;
  if (!inst || inst.sale_id !== saleId) {
    return { error: "La cuota seleccionada no pertenece a esta venta." };
  }

  const payload = {
    sale_id: saleId,
    amount,
    ...(paidAt && { paid_at: paidAt }),
    notes,
    installment_id,
    payment_method_id,
    ...(original_currency && { original_currency }),
    ...(transaction_number !== null && { transaction_number }),
  } as never;

  const { error } = await supabase.from("payments").insert(payload);
  if (error) return { error: error.message };

  await revalidateForSale(projectId, saleId);
  return { ok: true };
}

/**
 * Re-linkea un cobro histórico (o huérfano tras regenerar cuotas) a una
 * cuota puntual de su venta. Sirve para el flujo de carga de clientes
 * existentes que describía el brief de Fase 11: cambio el plan de la venta,
 * los payments quedan flotando, el operador los asigna uno por uno.
 *
 * `installmentId=null` es válido — desasigna el cobro (queda huérfano de
 * vuelta). El método de pago se toca por separado con `updatePaymentMethod`.
 */
export async function updatePaymentInstallment(
  projectId: string,
  paymentId: string,
  installmentId: string | null,
): Promise<{ ok: true } | { error: string }> {
  await requireCanEditLaunchesIn(projectId);
  const supabase = await createClient();

  // Lookup del sale_id del payment para revalidar y validar integridad.
  const { data: payRow } = await supabase
    .from("payments")
    .select("sale_id")
    .eq("id", paymentId)
    .maybeSingle();
  const pay = payRow as { sale_id: string } | null;
  if (!pay) return { error: "Cobro inexistente." };

  if (installmentId) {
    const { data: instRow } = await supabase
      .from("installments")
      .select("sale_id")
      .eq("id", installmentId)
      .maybeSingle();
    const inst = instRow as { sale_id: string } | null;
    if (!inst || inst.sale_id !== pay.sale_id) {
      return { error: "La cuota no pertenece a esta venta." };
    }
  }

  const payload = { installment_id: installmentId } as never;
  const { error } = await supabase
    .from("payments")
    .update(payload)
    .eq("id", paymentId);
  if (error) return { error: error.message };

  await revalidateForSale(projectId, pay.sale_id);
  return { ok: true };
}

/**
 * Setea/limpia el método de pago de un cobro. Pensado para backfill de
 * cobros históricos que quedaron con `payment_method_id = NULL` tras la
 * migración 0043.
 */
export async function updatePaymentMethod(
  projectId: string,
  paymentId: string,
  paymentMethodId: string | null,
): Promise<{ ok: true } | { error: string }> {
  await requireCanEditLaunchesIn(projectId);
  const supabase = await createClient();

  const { data: payRow } = await supabase
    .from("payments")
    .select("sale_id")
    .eq("id", paymentId)
    .maybeSingle();
  const pay = payRow as { sale_id: string } | null;
  if (!pay) return { error: "Cobro inexistente." };

  const payload = { payment_method_id: paymentMethodId } as never;
  const { error } = await supabase
    .from("payments")
    .update(payload)
    .eq("id", paymentId);
  if (error) return { error: error.message };

  await revalidateForSale(projectId, pay.sale_id);
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

  // Revalidamos con scope de proyecto: bulk toca N launches, no vale la
  // pena revalidar uno por uno. Layout de launches cubre detail + subtabs.
  // También overview y listado top-level para que sus KPIs agregados vean
  // los nuevos snapshots.
  revalidatePath(`/proyectos/${projectId}`);
  revalidatePath(`/proyectos/${projectId}/launches`, "layout");
  revalidatePath(`/proyectos/${projectId}/leads`);

  return { updated, failed, firstError };
}
