"use server";

import { revalidatePath } from "next/cache";

import { calculateForward, type ForwardInput } from "@/lib/calculator/forward";
import { calculateReverse, type ReverseInput } from "@/lib/calculator/reverse";
import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export type ClientProjectionActionState = { ok: true } | { error: string } | null;

const VALID_MODES = ["reverse", "forward"] as const;

function isReverseInput(v: unknown): v is ReverseInput {
  return typeof v === "object" && v !== null && "revenueGoal" in v;
}
function isForwardInput(v: unknown): v is ForwardInput {
  return typeof v === "object" && v !== null && "adBudget" in v;
}

/**
 * Guarda una proyección creada por el cliente. Diff vs `saveProjection` del
 * equipo (`(app)/calculadora/actions.ts`):
 *   - Rol: requireRole('cliente'); el equipo usa requireCanEditProject(admin+).
 *   - Pertenencia: la RLS `projections_insert` exige que el row tenga
 *     `created_by = auth.uid()` cuando viene de `cliente_role`. Si el cliente
 *     intenta insertar para un projectId del que no es miembro,
 *     `has_project_access` devuelve false y postgres lanza 42501.
 *   - Recompute server-side: idéntico al del equipo — el cliente no puede
 *     forjar un outputs blob que no matchee los inputs.
 */
export async function saveClientProjection(
  _prev: ClientProjectionActionState,
  formData: FormData,
): Promise<ClientProjectionActionState> {
  const profile = await requireRole("cliente");

  const projectId = String(formData.get("project_id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const mode = String(formData.get("mode") ?? "").trim();
  const inputsJson = String(formData.get("inputs") ?? "").trim();

  if (!projectId) return { error: "Elegí un proyecto." };
  if (!name) return { error: "Poné un nombre." };
  if (!(VALID_MODES as readonly string[]).includes(mode)) {
    return { error: "Modo inválido." };
  }

  let inputs: unknown;
  try {
    inputs = JSON.parse(inputsJson);
  } catch {
    return { error: "Inputs inválidos." };
  }

  let outputs: object;
  if (mode === "reverse") {
    if (!isReverseInput(inputs)) return { error: "Inputs de reverse inválidos." };
    outputs = calculateReverse(inputs);
  } else {
    if (!isForwardInput(inputs)) return { error: "Inputs de forward inválidos." };
    outputs = calculateForward(inputs);
  }

  const supabase = await createClient();
  const payload = {
    project_id: projectId,
    created_by: profile.id,
    name,
    mode,
    inputs,
    outputs,
  } as never;
  const { error } = await supabase.from("projections").insert(payload);

  if (error) return { error: error.message };

  revalidatePath("/portal/calculadora");
  return { ok: true };
}

/**
 * Borra una proyección del cliente. La policy `projections_delete` filtra al
 * created_by = auth.uid(), así que si el cliente envía un id que no es suyo,
 * el DELETE no toca filas y el server action devuelve void normal.
 */
export async function deleteClientProjection(projectionId: string): Promise<void> {
  await requireRole("cliente");

  const supabase = await createClient();
  await supabase.from("projections").delete().eq("id", projectionId);

  revalidatePath("/portal/calculadora");
}
