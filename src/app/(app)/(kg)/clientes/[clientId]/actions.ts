"use server";

import { revalidatePath } from "next/cache";

import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// Actions de la ficha del cliente. Atar / desatar projects.
//
// Un project pertenece a lo sumo a UN cliente (projects.client_id nullable
// en 0110). Para "mover" un project entre clientes, primero se desata del
// actual y después se ata al nuevo — no hay reasignación directa. Es
// consciente: reduce la superficie de errores accidentales.
// ═══════════════════════════════════════════════════════════════════════════

export type AttachProjectResult = { ok: true } | { error: string };

export type DetachProjectResult = { ok: true } | { error: string };

// ═══════════════════════════════════════════════════════════════════════════
// attachProjectToClient — asocia un project al cliente
//
// Guard: el project TIENE que estar sin cliente atado. Si ya pertenece a
// otro cliente, rebota. El operador tiene que ir al otro cliente y
// desatarlo primero. Esta política evita que un click accidental mueva
// silenciosamente un project que pertenece a otro cliente.
// ═══════════════════════════════════════════════════════════════════════════

export async function attachProjectToClient(
  clientId: string,
  projectId: string,
): Promise<AttachProjectResult> {
  if (!clientId) return { error: "Falta el id del cliente." };
  if (!projectId) return { error: "Falta el id del project." };

  const supabase = await createSupabaseClient();

  const { data: current, error: readErr } = await supabase
    .from("projects")
    .select("id, name, client_id")
    .eq("id", projectId)
    .maybeSingle();

  if (readErr) return { error: readErr.message };
  const row = current as
    | { id: string; name: string; client_id: string | null }
    | null;
  if (!row) {
    return {
      error: "El project ya no existe o no tenés acceso. Recargá y reintentá.",
    };
  }
  if (row.client_id === clientId) {
    // Idempotencia — si alguien re-clickea, no dolemos.
    return { ok: true };
  }
  if (row.client_id != null) {
    return {
      error:
        `El project "${row.name}" ya está atado a otro cliente. Desatalo desde ese cliente antes de reatarlo acá.`,
    };
  }

  const payload = { client_id: clientId } as never;
  const { error } = await supabase
    .from("projects")
    .update(payload)
    .eq("id", projectId);
  if (error) return { error: error.message };

  revalidatePath(`/clientes/${clientId}`);
  revalidatePath("/clientes");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// detachProjectFromClient — quita la atadura (client_id = null)
//
// No borra el project — solo la referencia. El project sigue existiendo
// en LaunchOS con toda su información; deja de aparecer en la ficha del
// cliente y puede reatarse a otro cliente después.
// ═══════════════════════════════════════════════════════════════════════════

export async function detachProjectFromClient(
  projectId: string,
): Promise<DetachProjectResult> {
  if (!projectId) return { error: "Falta el id del project." };

  const supabase = await createSupabaseClient();

  // Leo el client_id actual para invalidar la ruta correcta.
  const { data: current } = await supabase
    .from("projects")
    .select("client_id")
    .eq("id", projectId)
    .maybeSingle();
  const previousClientId =
    (current as { client_id: string | null } | null)?.client_id ?? null;

  const payload = { client_id: null } as never;
  const { error } = await supabase
    .from("projects")
    .update(payload)
    .eq("id", projectId);
  if (error) return { error: error.message };

  if (previousClientId) {
    revalidatePath(`/clientes/${previousClientId}`);
  }
  revalidatePath("/clientes");
  return { ok: true };
}
