"use server";

import { revalidatePath } from "next/cache";

import {
  previewFxBackfill,
  runFxBackfill,
  type FxBackfillReport,
} from "@/lib/backfill/fx";
import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// Server actions para `project_fx_rates` (mig 0103).
//
// La tabla vive por-proyecto y tiene UN valor por mes. Se usa como fallback
// para convertir a USD movimientos que NO están atados a un launch (gastos,
// nómina, movimientos manuales de banco, facturas).
//
// Sin edit-in-place: el flujo natural es "borrás la tasa vieja y creás otra"
// — el UNIQUE (project_id, month) rechazaría un insert duplicado, así que si
// querés cambiar la tasa de un mes, borrala primero. Alternativa considerada:
// upsert por mes; descartada porque un cambio silencioso a la tasa de un
// mes viejo desplaza todos los dashboards históricos y prefiero el paso
// explícito.
// ═══════════════════════════════════════════════════════════════════════════

export type CreateFxRateState =
  | { ok: true }
  | { error: string }
  | null;

export async function createFxRate(
  _prev: CreateFxRateState,
  formData: FormData,
): Promise<CreateFxRateState> {
  await requireRole("superadmin");

  const projectId = String(formData.get("project_id") ?? "").trim();
  if (projectId.length === 0) return { error: "Elegí un proyecto." };

  // El input `type=month` envía YYYY-MM. Lo normalizamos a YYYY-MM-01 para
  // que coincida con el CHECK del DB (month = date_trunc('month', month)).
  const monthRaw = String(formData.get("month") ?? "").trim();
  const monthMatch = /^(\d{4})-(\d{2})$/.exec(monthRaw);
  if (!monthMatch) {
    return { error: "El mes tiene que estar en formato YYYY-MM." };
  }
  const month = `${monthMatch[1]}-${monthMatch[2]}-01`;

  const rateRaw = String(formData.get("ars_per_usd") ?? "").trim();
  const rate = Number(rateRaw);
  if (!Number.isFinite(rate) || rate <= 0) {
    return { error: "La tasa tiene que ser un número mayor a 0." };
  }

  const supabase = await createClient();
  const payload = {
    project_id: projectId,
    month,
    ars_per_usd: rate,
  } as never;

  const { error } = await supabase.from("project_fx_rates").insert(payload);
  if (error) {
    if (error.code === "23505") {
      return {
        error: `Ya hay una tasa cargada para ${monthMatch[1]}-${monthMatch[2]}. Borrala primero si querés cambiarla.`,
      };
    }
    return { error: error.message };
  }

  revalidatePath("/financiero/tasas");
  revalidatePath("/financiero");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// Backfill one-shot: convertir a USD payments/sales históricos cargados en
// pesos contra bancos USD. `preview` no toca nada — se usa para mostrar en
// la UI qué va a pasar antes de que el operador confirme. `run` aplica.
// ═══════════════════════════════════════════════════════════════════════════

export type FxBackfillState =
  | { ok: true; report: FxBackfillReport }
  | { error: string }
  | null;

export async function previewFxBackfillAction(
  _prev: FxBackfillState,
  _formData: FormData,
): Promise<FxBackfillState> {
  await requireRole("superadmin");
  try {
    const report = await previewFxBackfill();
    return { ok: true, report };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Preview falló." };
  }
}

export async function runFxBackfillAction(
  _prev: FxBackfillState,
  _formData: FormData,
): Promise<FxBackfillState> {
  await requireRole("superadmin");
  try {
    const report = await runFxBackfill();
    revalidatePath("/financiero/bancos");
    revalidatePath("/financiero/metodos-pago");
    revalidatePath("/financiero");
    return { ok: true, report };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Backfill falló." };
  }
}

export async function deleteFxRate(rateId: string): Promise<{
  ok: true;
} | { error: string }> {
  await requireRole("superadmin");

  const supabase = await createClient();
  const { error } = await supabase
    .from("project_fx_rates")
    .delete()
    .eq("id", rateId);

  if (error) return { error: error.message };

  revalidatePath("/financiero/tasas");
  revalidatePath("/financiero");
  return { ok: true };
}
