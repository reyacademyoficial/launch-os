"use server";

import { revalidatePath } from "next/cache";

import { calculateForward, type ForwardInput } from "@/lib/calculator/forward";
import { calculateReverse, type ReverseInput } from "@/lib/calculator/reverse";
import {
  requireCanEditProject,
  requireSessionProfile,
} from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export type ProjectionActionState = { ok: true } | { error: string } | null;

const VALID_MODES = ["reverse", "forward"] as const;

function isReverseInput(v: unknown): v is ReverseInput {
  return typeof v === "object" && v !== null && "revenueGoal" in v;
}

function isForwardInput(v: unknown): v is ForwardInput {
  return typeof v === "object" && v !== null && "adBudget" in v;
}

/**
 * Saves a calculator scenario. We recompute the outputs server-side from the
 * persisted inputs so the snapshot is internally consistent — clients can't
 * forge an outputs blob that doesn't match the math.
 */
export async function saveProjection(
  _prev: ProjectionActionState,
  formData: FormData,
): Promise<ProjectionActionState> {
  await requireSessionProfile();

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

  const profile = await requireCanEditProject(projectId);

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

  revalidatePath("/calculadora");
  return { ok: true };
}

/**
 * Deletes a projection. RLS doubles as the permission gate: only callers who
 * `can_edit_project` for the projection's project pass the policy.
 */
export async function deleteProjection(projectionId: string): Promise<void> {
  await requireSessionProfile();

  const supabase = await createClient();
  await supabase.from("projections").delete().eq("id", projectionId);

  revalidatePath("/calculadora");
}
