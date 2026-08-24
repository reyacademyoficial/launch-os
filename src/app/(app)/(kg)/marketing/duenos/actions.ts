"use server";

import { revalidatePath } from "next/cache";

import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// CRUD de content_owners (dueños de contenido del módulo Marketing).
// Patrón calcado de /clientes/actions.ts — mismo contrato discriminated
// union, mismo manejo de 23505 (unique parcial por lower(name) activo).
// ═══════════════════════════════════════════════════════════════════════════

export type CreateOwnerState =
  | { ok: true; ownerId: string }
  | { error: string }
  | null;

export type UpdateOwnerState = { ok: true } | { error: string } | null;

export type ToggleOwnerResult = { ok: true } | { error: string };

export type DeleteOwnerResult = { ok: true } | { error: string };

function nullIfEmpty(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Handles se guardan sin `@`. Si el usuario lo pega con `@`, lo pelamos —
 * lo mismo pasa con espacios sobrantes. Vacío → null (columna nullable).
 */
function normalizeHandle(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim().replace(/^@+/, "");
  return trimmed.length === 0 ? null : trimmed;
}

interface OwnerPayload {
  readonly name: string;
  readonly handleInstagram: string | null;
  readonly handleFacebook: string | null;
  readonly handleTiktok: string | null;
  readonly handleYoutube: string | null;
  readonly notes: string | null;
  readonly active: boolean;
}

function parseOwnerFormData(
  formData: FormData,
  { defaultActive }: { defaultActive: boolean },
): OwnerPayload | string {
  const name = String(formData.get("name") ?? "").trim();
  if (name.length === 0) return "El nombre es obligatorio.";
  if (name.length > 120) return "El nombre es demasiado largo (máximo 120 caracteres).";

  const handleInstagram = normalizeHandle(formData.get("handle_instagram"));
  const handleFacebook = normalizeHandle(formData.get("handle_facebook"));
  const handleTiktok = normalizeHandle(formData.get("handle_tiktok"));
  const handleYoutube = normalizeHandle(formData.get("handle_youtube"));
  const notes = nullIfEmpty(formData.get("notes"));

  const activeRaw = formData.get("active");
  const active =
    activeRaw === null ? defaultActive : String(activeRaw) === "on";

  return {
    name,
    handleInstagram,
    handleFacebook,
    handleTiktok,
    handleYoutube,
    notes,
    active,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// createOwner — alta de dueño de contenido.
// ═══════════════════════════════════════════════════════════════════════════

export async function createOwner(
  _prev: CreateOwnerState,
  formData: FormData,
): Promise<CreateOwnerState> {
  const parsed = parseOwnerFormData(formData, { defaultActive: true });
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
    handle_instagram: parsed.handleInstagram,
    handle_facebook: parsed.handleFacebook,
    handle_tiktok: parsed.handleTiktok,
    handle_youtube: parsed.handleYoutube,
    notes: parsed.notes,
    active: parsed.active,
  } as never;

  const { data, error } = await supabase
    .from("content_owners")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        error:
          "Ya existe un dueño activo con ese nombre en la organización. Usá otro nombre o reactivá el existente.",
      };
    }
    return { error: error.message };
  }

  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath("/marketing/duenos");
  return { ok: true, ownerId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateOwner
// ═══════════════════════════════════════════════════════════════════════════

export async function updateOwner(
  ownerId: string,
  _prev: UpdateOwnerState,
  formData: FormData,
): Promise<UpdateOwnerState> {
  if (!ownerId) return { error: "Falta el id del dueño." };

  const parsed = parseOwnerFormData(formData, { defaultActive: true });
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();
  const payload = {
    name: parsed.name,
    handle_instagram: parsed.handleInstagram,
    handle_facebook: parsed.handleFacebook,
    handle_tiktok: parsed.handleTiktok,
    handle_youtube: parsed.handleYoutube,
    notes: parsed.notes,
    active: parsed.active,
  } as never;

  const { error } = await supabase
    .from("content_owners")
    .update(payload)
    .eq("id", ownerId);

  if (error) {
    if (error.code === "23505") {
      return {
        error: "Ya existe otro dueño activo con ese nombre en la organización.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/marketing/duenos");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// deactivateOwner / reactivateOwner — soft delete via `active` flag.
// ═══════════════════════════════════════════════════════════════════════════

export async function deactivateOwner(
  ownerId: string,
): Promise<ToggleOwnerResult> {
  if (!ownerId) return { error: "Falta el id del dueño." };
  const supabase = await createSupabaseClient();
  const payload = { active: false } as never;
  const { error } = await supabase
    .from("content_owners")
    .update(payload)
    .eq("id", ownerId);
  if (error) return { error: error.message };
  revalidatePath("/marketing/duenos");
  return { ok: true };
}

export async function reactivateOwner(
  ownerId: string,
): Promise<ToggleOwnerResult> {
  if (!ownerId) return { error: "Falta el id del dueño." };
  const supabase = await createSupabaseClient();
  const payload = { active: true } as never;
  const { error } = await supabase
    .from("content_owners")
    .update(payload)
    .eq("id", ownerId);
  if (error) {
    if (error.code === "23505") {
      return {
        error:
          "No se puede reactivar: hay otro dueño activo con el mismo nombre. Renombralo antes.",
      };
    }
    return { error: error.message };
  }
  revalidatePath("/marketing/duenos");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// deleteOwner — hard delete con guard.
//
// Hoy solo hay cadencias colgadas del owner (0158 tiene `on delete cascade`).
// Cuando se sumen 0159 (content_pieces), 0160 (recording_sessions), 0162
// (assets) — TODOS con FK a content_owner_id — extender este guard con esas
// deps. Por ahora chequear solo cadencias y proponer archivar en su lugar.
// ═══════════════════════════════════════════════════════════════════════════

export async function deleteOwner(
  ownerId: string,
): Promise<DeleteOwnerResult> {
  if (!ownerId) return { error: "Falta el id del dueño." };

  const supabase = await createSupabaseClient();

  const { count: cadencesCount, error: cadencesErr } = await supabase
    .from("publishing_cadences")
    .select("content_owner_id", { count: "exact", head: true })
    .eq("content_owner_id", ownerId);
  if (cadencesErr) return { error: cadencesErr.message };

  if ((cadencesCount ?? 0) > 0) {
    return {
      error:
        `No se puede eliminar: el dueño tiene ${cadencesCount} cadencia${cadencesCount === 1 ? "" : "s"} configurada${cadencesCount === 1 ? "" : "s"}. ` +
        "Borrá las cadencias primero, o usá 'Archivar' en su lugar (reversible, no destruye datos).",
    };
  }

  const { error } = await supabase
    .from("content_owners")
    .delete()
    .eq("id", ownerId);
  if (error) return { error: error.message };

  revalidatePath("/marketing/duenos");
  return { ok: true };
}
