"use server";

import { revalidatePath } from "next/cache";

import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// Contratos de retorno — patrón discriminated union del resto de la app.
// ═══════════════════════════════════════════════════════════════════════════

export type CreateClientState =
  | { ok: true; clientId: string }
  | { error: string }
  | null;

export type UpdateClientState = { ok: true } | { error: string } | null;

export type ToggleClientResult = { ok: true } | { error: string };

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function nullIfEmpty(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

interface ClientPayload {
  readonly name: string;
  readonly businessName: string | null;
  readonly industry: string | null;
  readonly notes: string | null;
  readonly active: boolean;
}

/** Devuelve payload validado o string de error. */
function parseClientFormData(
  formData: FormData,
  { defaultActive }: { defaultActive: boolean },
): ClientPayload | string {
  const name = String(formData.get("name") ?? "").trim();
  if (name.length === 0) return "El nombre es obligatorio.";
  if (name.length > 200) return "El nombre es demasiado largo (máximo 200 caracteres).";

  const businessName = nullIfEmpty(formData.get("business_name"));
  const industry = nullIfEmpty(formData.get("industry"));
  const notes = nullIfEmpty(formData.get("notes"));

  // Checkbox: presente => true, ausente => false. En create el drawer no
  // muestra el checkbox (siempre nace activo), por eso caemos al default.
  const activeRaw = formData.get("active");
  const active =
    activeRaw === null || activeRaw === undefined
      ? defaultActive
      : String(activeRaw) === "on" || String(activeRaw) === "true";

  return { name, businessName, industry, notes, active };
}

// ═══════════════════════════════════════════════════════════════════════════
// createClient — alta de cliente
//
// Todo nace activo (default true). El unique parcial
// clients(organization_id, lower(name)) where active rebota con 23505 si el
// nombre choca con un cliente activo — el mensaje se traduce a texto amable.
// Si el nombre coincide con uno archivado, pasa: el archivado no está en el
// índice activo.
// ═══════════════════════════════════════════════════════════════════════════

export async function createClient(
  _prev: CreateClientState,
  formData: FormData,
): Promise<CreateClientState> {
  const parsed = parseClientFormData(formData, { defaultActive: true });
  if (typeof parsed === "string") return { error: parsed };

  let organizationId: string | null;
  try {
    organizationId = await resolveCurrentOrganizationId();
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Error resolviendo la organización.",
    };
  }
  if (!organizationId) {
    return { error: "No pudimos resolver tu organización. Revisá tus permisos." };
  }

  const supabase = await createSupabaseClient();
  const payload = {
    organization_id: organizationId,
    name: parsed.name,
    business_name: parsed.businessName,
    industry: parsed.industry,
    notes: parsed.notes,
    active: parsed.active,
  } as never;

  const { data, error } = await supabase
    .from("clients")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        error:
          "Ya existe un cliente activo con ese nombre en la organización. Usá otro nombre o reactivá el existente.",
      };
    }
    return { error: error.message };
  }

  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath("/clientes");
  return { ok: true, clientId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateClient — edición de cliente
//
// El active del form respetado (el drawer edit sí lo muestra). Chocar contra
// otro cliente activo con el mismo nombre rebota con 23505.
// ═══════════════════════════════════════════════════════════════════════════

export async function updateClient(
  clientId: string,
  _prev: UpdateClientState,
  formData: FormData,
): Promise<UpdateClientState> {
  if (!clientId) return { error: "Falta el id del cliente." };

  const parsed = parseClientFormData(formData, { defaultActive: true });
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();
  const payload = {
    name: parsed.name,
    business_name: parsed.businessName,
    industry: parsed.industry,
    notes: parsed.notes,
    active: parsed.active,
  } as never;

  const { error } = await supabase
    .from("clients")
    .update(payload)
    .eq("id", clientId);

  if (error) {
    if (error.code === "23505") {
      return {
        error:
          "Ya existe otro cliente activo con ese nombre en la organización.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/clientes");
  revalidatePath(`/clientes/${clientId}`);
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// deactivateClient / reactivateClient — soft delete via `active` flag.
//
// No hay hard delete: dropear un cliente destruiría en cascada su health,
// nps, renewals, upsells y tickets (por on delete cascade en 0110). El
// archivado es reversible; el borrado no. Si un cliente inactivo choca al
// reactivar con otro activo de mismo nombre, rebota con 23505.
// ═══════════════════════════════════════════════════════════════════════════

export async function deactivateClient(
  clientId: string,
): Promise<ToggleClientResult> {
  if (!clientId) return { error: "Falta el id del cliente." };
  const supabase = await createSupabaseClient();
  const payload = { active: false } as never;
  const { error } = await supabase
    .from("clients")
    .update(payload)
    .eq("id", clientId);
  if (error) return { error: error.message };
  revalidatePath("/clientes");
  return { ok: true };
}

export async function reactivateClient(
  clientId: string,
): Promise<ToggleClientResult> {
  if (!clientId) return { error: "Falta el id del cliente." };
  const supabase = await createSupabaseClient();
  const payload = { active: true } as never;
  const { error } = await supabase
    .from("clients")
    .update(payload)
    .eq("id", clientId);
  if (error) {
    if (error.code === "23505") {
      return {
        error:
          "No se puede reactivar: hay otro cliente activo con el mismo nombre. Renombralo antes.",
      };
    }
    return { error: error.message };
  }
  revalidatePath("/clientes");
  return { ok: true };
}
