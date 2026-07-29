/**
 * Resolvedor de "la organización actual del usuario".
 *
 * Hoy la plataforma tiene una sola organización (Kingrow, sembrada en 0050
 * con UUID determinista). La RLS de `organization` filtra por
 * `can_edit_organization`, así que un authenticated user solo ve las orgs
 * que puede editar. Cuando llegue multi-org, este archivo se convierte en
 * el único lugar que hay que tocar para introducir un selector.
 *
 * El guardarraíl importante: si el usuario alcanza a ver MÁS de una org y
 * todavía no existe selector, tiramos error. La alternativa era elegir "la
 * primera" en silencio y arriesgar que una persona o una regla se cargue en
 * la organización equivocada — el silencio en escrituras económicas no vale.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

type AnySupabase = SupabaseClient<any, any, any>;

/**
 * Pura, testeable. Dada la lista de orgs visibles por RLS, decide cuál usar.
 *   - 0 filas: null (el caller lo traduce a "no hay permisos").
 *   - 1 fila: el id (caso hoy).
 *   - 2+ filas: throw. No hay un default seguro cuando escribir en la org
 *     equivocada tiene consecuencia económica.
 */
export function pickCurrentOrganizationId(
  rows: readonly { readonly id: string }[],
): string | null {
  if (rows.length === 0) return null;
  if (rows.length > 1) {
    throw new Error(
      "Detecté más de una organización visible para tu rol. Añadí un selector antes de continuar.",
    );
  }
  return rows[0]!.id;
}

/**
 * Wrapper thin: hace la query mínima y delega la decisión a la pura. `.limit(2)`
 * porque solo necesitamos distinguir 0 / 1 / 2+ — traer más filas no aporta.
 */
export async function resolveCurrentOrganizationId(
  supabase?: AnySupabase,
): Promise<string | null> {
  const client = supabase ?? (await createClient());
  const { data } = await client.from("organization").select("id").limit(2);
  const rows = (data ?? []) as { id: string }[];
  return pickCurrentOrganizationId(rows);
}
