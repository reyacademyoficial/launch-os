import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// Resolver del person_id del usuario logueado.
//
// Habilitado por la migración 0111 (organization_people.auth_user_id).
// Usado por:
//   - /operaciones/tareas → filtro "mis tareas" por default (server-scoped
//     por assignee_id = personId del user).
//   - Widget "Mi Jornada" del sidebar cuando se retome (Anexo A del plan).
//
// Retorna `null` si:
//   - No hay sesión (usuario no logueado).
//   - El user no tiene persona vinculada (típicamente dev/admin externo
//     que opera la plataforma pero no tiene fila en organization_people).
//
// El caller decide cómo tratarlo. Para el filtro "mis tareas": si es null,
// la vista rebota o muestra empty state con instrucción de "pedir al admin
// que te vincule con tu persona en Organización → Personas".
//
// Cacheable per-request con React `cache()` — múltiples componentes server
// que lo llamen en el mismo render comparten el resultado.
// ═══════════════════════════════════════════════════════════════════════════

interface PersonIdRow {
  readonly id: string;
}

export const resolveCurrentPersonId = cache(
  async (): Promise<string | null> => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data } = await supabase
      .from("organization_people")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    return (data as PersonIdRow | null)?.id ?? null;
  },
);
