"use server";

import { revalidatePath } from "next/cache";

import { isValidAssetType } from "@/lib/finance/asset-types";
import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

import { translateAssetError } from "./translate-error";

// ═══════════════════════════════════════════════════════════════════════════
// Contratos de retorno — mismo patrón discriminated que el resto del módulo
// ═══════════════════════════════════════════════════════════════════════════

export type CreateAssetState =
  | { ok: true; assetId: string }
  | { error: string }
  | null;

export type UpdateAssetState = { ok: true } | { error: string } | null;

export type ToggleAssetActiveResult = { ok: true } | { error: string };

// ═══════════════════════════════════════════════════════════════════════════
// Payload compartido create/update — mismos campos
// ═══════════════════════════════════════════════════════════════════════════

interface AssetPayload {
  readonly name: string;
  readonly assetType: string;
  readonly description: string | null;
  readonly amount: number;
  readonly originalCost: number | null;
  readonly depreciation: number;
  readonly currency: string;
  readonly acquiredAt: string | null;
  readonly notes: string | null;
}

function parseAssetFormData(formData: FormData): AssetPayload | string {
  const name = String(formData.get("name") ?? "").trim();
  if (name.length === 0) return "El nombre del activo es obligatorio.";

  const assetTypeRaw = String(formData.get("asset_type") ?? "").trim();
  // El CHECK del DB rechaza valores fuera de la lista, pero validamos acá
  // para dar mensaje friendly antes del round-trip.
  if (!isValidAssetType(assetTypeRaw)) {
    return "Elegí un tipo de activo válido.";
  }
  const assetType = assetTypeRaw;

  const description = nullIfEmpty(formData.get("description"));

  const amount = Number(formData.get("amount"));
  if (!Number.isFinite(amount) || amount < 0) {
    return "El valor en libros tiene que ser un número positivo o 0.";
  }

  const originalCostRaw = formData.get("original_cost");
  const originalCost =
    originalCostRaw == null || originalCostRaw === ""
      ? null
      : Number(originalCostRaw);
  if (originalCost != null && (!Number.isFinite(originalCost) || originalCost < 0)) {
    return "El costo original tiene que ser un número positivo o quedar vacío.";
  }

  const depreciationRaw = formData.get("depreciation");
  const depreciation =
    depreciationRaw == null || depreciationRaw === ""
      ? 0
      : Number(depreciationRaw);
  if (!Number.isFinite(depreciation) || depreciation < 0) {
    return "La depreciación tiene que ser un número positivo o 0.";
  }

  const currencyRaw = String(formData.get("currency") ?? "ARS").trim().toUpperCase();
  const currency = currencyRaw.length > 0 ? currencyRaw : "ARS";

  const acquiredAtRaw = String(formData.get("acquired_at") ?? "").trim();
  const acquiredAt = acquiredAtRaw.length === 0 ? null : acquiredAtRaw;
  if (acquiredAt != null && !isYmd(acquiredAt)) {
    return "La fecha de adquisición no es válida.";
  }

  const notes = nullIfEmpty(formData.get("notes"));

  return {
    name,
    assetType,
    description,
    amount,
    originalCost,
    depreciation,
    currency,
    acquiredAt,
    notes,
  };
}

function nullIfEmpty(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// ═══════════════════════════════════════════════════════════════════════════
// createAsset
// ═══════════════════════════════════════════════════════════════════════════

export async function createAsset(
  _prev: CreateAssetState,
  formData: FormData,
): Promise<CreateAssetState> {
  await requireRole("superadmin");

  const parsed = parseAssetFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  let organizationId: string | null;
  try {
    organizationId = await resolveCurrentOrganizationId();
  } catch (e) {
    return {
      error:
        e instanceof Error ? e.message : "Error resolviendo la organización.",
    };
  }
  if (!organizationId) {
    return { error: "No pudimos resolver tu organización. Revisá tus permisos." };
  }

  const supabase = await createClient();
  const payload = {
    organization_id: organizationId,
    name: parsed.name,
    asset_type: parsed.assetType,
    description: parsed.description,
    // account_id queda null a propósito — mismo criterio que gastos: los
    // satélites (accounts, cost_centers) se exponen cuando duela.
    account_id: null,
    amount: parsed.amount,
    original_cost: parsed.originalCost,
    depreciation: parsed.depreciation,
    currency: parsed.currency,
    acquired_at: parsed.acquiredAt,
    active: true,
    notes: parsed.notes,
  } as never;

  const { data, error } = await supabase
    .from("assets")
    .insert(payload)
    .select("id")
    .single();

  if (error) return { error: translateAssetError(error) };

  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath("/financiero/activos");
  // La Caja del dashboard se deriva de assets tipo caja/banco. Revalidar
  // /financiero para que la tarjeta se prenda de inmediato al insertar.
  revalidatePath("/financiero");
  return { ok: true, assetId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateAsset — mantiene `active` intacto (ese va por setAssetActive)
// ═══════════════════════════════════════════════════════════════════════════

export async function updateAsset(
  assetId: string,
  _prev: UpdateAssetState,
  formData: FormData,
): Promise<UpdateAssetState> {
  await requireRole("superadmin");

  const parsed = parseAssetFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createClient();
  const payload = {
    name: parsed.name,
    asset_type: parsed.assetType,
    description: parsed.description,
    amount: parsed.amount,
    original_cost: parsed.originalCost,
    depreciation: parsed.depreciation,
    currency: parsed.currency,
    acquired_at: parsed.acquiredAt,
    notes: parsed.notes,
    // NO tocamos `active`. Trigger set_updated_at (0067) actualiza el
    // updated_at automáticamente — es el que alimenta el "snapshot age"
    // del dashboard, así que actualizar el saldo de un banco lo mantiene
    // fresco sin trabajo extra.
  } as never;

  const { error } = await supabase.from("assets").update(payload).eq("id", assetId);

  if (error) return { error: translateAssetError(error) };

  revalidatePath("/financiero/activos");
  revalidatePath("/financiero");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// setAssetActive — toggle (dar de baja / reactivar)
// ═══════════════════════════════════════════════════════════════════════════
//
// No hay delete. Dar de baja es cambiar `active=false`; la fila queda como
// histórico pero deja de sumar al patrimonio y (si es caja/banco) a la Caja
// del dashboard. Reactivar es simétrico.

export async function setAssetActive(
  assetId: string,
  active: boolean,
): Promise<ToggleAssetActiveResult> {
  await requireRole("superadmin");

  const supabase = await createClient();
  const payload = { active } as never;

  const { error } = await supabase
    .from("assets")
    .update(payload)
    .eq("id", assetId);

  if (error) return { error: translateAssetError(error) };

  revalidatePath("/financiero/activos");
  revalidatePath("/financiero");
  return { ok: true };
}
