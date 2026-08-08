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

export type DeleteClientResult = { ok: true } | { error: string };

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

  // El drawer envía SIEMPRE un hidden input `active="on"|"off"` (controlado
  // por el toggle visual). Un checkbox HTML crudo omite el valor cuando
  // está unchecked — el hidden nos garantiza que el estado deseado llega
  // explícito y no dependemos de defaults. `defaultActive` cubre el caso
  // create donde el drawer no muestra toggle (siempre nace activo).
  const activeRaw = formData.get("active");
  const active =
    activeRaw === null
      ? defaultActive
      : String(activeRaw) === "on";

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

// ═══════════════════════════════════════════════════════════════════════════
// deleteClient — hard delete con guard duro.
//
// La migración 0110 pone `on delete cascade` en health/nps/renewals/upsells/
// tickets. Borrar un cliente con datos destruye toda su relación sin traza.
// Por eso el guard chequea CADA dependencia antes de borrar; solo permite
// eliminar clientes limpios (creados por error, sin nada colgado).
//
// projects.client_id tiene `on delete set null`, así que se puede borrar
// un cliente con projects atados sin destruir los projects — pero igual lo
// bloqueamos: si atamos un project, es porque el cliente importa. Que el
// usuario desate primero, o archive el cliente.
//
// Para archivar sin borrar: deactivateClient (soft delete reversible).
// ═══════════════════════════════════════════════════════════════════════════

export async function deleteClient(
  clientId: string,
): Promise<DeleteClientResult> {
  if (!clientId) return { error: "Falta el id del cliente." };

  const supabase = await createSupabaseClient();

  // Chequeo por cada dependencia. Usamos { count: 'exact', head: true }
  // para no traer las filas — solo el conteo.
  const [projectsRes, healthRes, npsRes, ticketsRes, renewalsRes, upsellsRes] =
    await Promise.all([
      supabase
        .from("projects")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientId),
      supabase
        .from("project_health")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientId),
      supabase
        .from("nps_responses")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientId),
      supabase
        .from("tickets")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientId),
      supabase
        .from("renewals")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientId),
      supabase
        .from("upsells")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientId),
    ]);

  const deps: string[] = [];
  const projectsCount = projectsRes.count ?? 0;
  const healthCount = healthRes.count ?? 0;
  const npsCount = npsRes.count ?? 0;
  const ticketsCount = ticketsRes.count ?? 0;
  const renewalsCount = renewalsRes.count ?? 0;
  const upsellsCount = upsellsRes.count ?? 0;

  if (projectsCount > 0) {
    deps.push(`${projectsCount} project${projectsCount === 1 ? "" : "s"} atado${projectsCount === 1 ? "" : "s"}`);
  }
  if (healthCount > 0) deps.push("health cargada");
  if (ticketsCount > 0) {
    deps.push(`${ticketsCount} ticket${ticketsCount === 1 ? "" : "s"}`);
  }
  if (renewalsCount > 0) {
    deps.push(`${renewalsCount} renewal${renewalsCount === 1 ? "" : "s"}`);
  }
  if (upsellsCount > 0) {
    deps.push(`${upsellsCount} upsell${upsellsCount === 1 ? "" : "s"}`);
  }
  if (npsCount > 0) {
    deps.push(`${npsCount} respuesta${npsCount === 1 ? "" : "s"} de NPS`);
  }

  if (deps.length > 0) {
    return {
      error:
        `No se puede eliminar: el cliente tiene ${deps.join(", ")}. ` +
        "Desatá los projects o borrá las dependencias primero, o usá 'Archivar' " +
        "en su lugar (reversible, no destruye datos).",
    };
  }

  const { error } = await supabase.from("clients").delete().eq("id", clientId);
  if (error) return { error: error.message };

  revalidatePath("/clientes");
  return { ok: true };
}
