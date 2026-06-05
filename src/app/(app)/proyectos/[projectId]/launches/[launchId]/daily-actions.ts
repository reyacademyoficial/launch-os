"use server";

import { revalidatePath } from "next/cache";

import { DAILY_CHANNELS } from "@/lib/launch-daily/types";
import { requireCanEditProject } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export type DailyActionState = { ok: true } | { error: string } | null;

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function int(formData: FormData, key: string): number {
  const v = str(formData, key);
  if (v === "") return 0;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

interface DailyPayload {
  date: string;
  meta_ads: number;
  google_ads: number;
  tiktok_ads: number;
  organico: number;
  whatsapp: number;
  referidos: number;
  otro: number;
}

function parseFromForm(
  formData: FormData,
): { ok: true; payload: DailyPayload } | { ok: false; error: string } {
  const date = str(formData, "date");
  if (!date) return { ok: false, error: "La fecha es obligatoria." };

  return {
    ok: true,
    payload: {
      date,
      meta_ads: int(formData, "meta_ads"),
      google_ads: int(formData, "google_ads"),
      tiktok_ads: int(formData, "tiktok_ads"),
      organico: int(formData, "organico"),
      whatsapp: int(formData, "whatsapp"),
      referidos: int(formData, "referidos"),
      otro: int(formData, "otro"),
    },
  };
}

function isAllZero(p: DailyPayload): boolean {
  return DAILY_CHANNELS.every((ch) => p[ch] === 0);
}

/**
 * Creates a daily entry for a launch. The (launch_id, date) unique constraint
 * blocks duplicates — surface that as a friendly error.
 */
export async function createDailyEntry(
  projectId: string,
  launchId: string,
  _prev: DailyActionState,
  formData: FormData,
): Promise<DailyActionState> {
  await requireCanEditProject(projectId);

  const parsed = parseFromForm(formData);
  if (!parsed.ok) return { error: parsed.error };
  if (isAllZero(parsed.payload)) {
    return { error: "Cargá leads en al menos un canal." };
  }

  const supabase = await createClient();
  const payload = { ...parsed.payload, launch_id: launchId } as never;
  const { error } = await supabase.from("launch_daily").insert(payload);

  if (error) {
    if (error.code === "23505") {
      return { error: "Ya hay datos cargados para esa fecha. Editalos en su lugar." };
    }
    return { error: error.message };
  }

  revalidatePath(`/proyectos/${projectId}/launches/${launchId}`);
  return { ok: true };
}

/**
 * Updates an existing daily entry. The id + launch_id pair scopes the write
 * so URL tampering can't reach another launch's row.
 */
export async function updateDailyEntry(
  projectId: string,
  launchId: string,
  entryId: string,
  _prev: DailyActionState,
  formData: FormData,
): Promise<DailyActionState> {
  await requireCanEditProject(projectId);

  const parsed = parseFromForm(formData);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();
  const payload = parsed.payload as never;
  const { error } = await supabase
    .from("launch_daily")
    .update(payload)
    .eq("id", entryId)
    .eq("launch_id", launchId);

  if (error) {
    if (error.code === "23505") {
      return { error: "Ya hay otro registro para esa fecha." };
    }
    return { error: error.message };
  }

  revalidatePath(`/proyectos/${projectId}/launches/${launchId}`);
  return { ok: true };
}

/**
 * Deletes a daily entry. Called from the inline confirm button — no return
 * state because the page revalidates and the row disappears.
 */
export async function deleteDailyEntry(
  projectId: string,
  launchId: string,
  entryId: string,
): Promise<void> {
  await requireCanEditProject(projectId);

  const supabase = await createClient();
  await supabase
    .from("launch_daily")
    .delete()
    .eq("id", entryId)
    .eq("launch_id", launchId);

  revalidatePath(`/proyectos/${projectId}/launches/${launchId}`);
}
