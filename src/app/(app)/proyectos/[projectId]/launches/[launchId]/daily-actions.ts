"use server";

import { revalidatePath } from "next/cache";

import { DAILY_CHANNELS } from "@/lib/launch-daily/types";
import { requireCanEditLaunchesIn } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export type DailyActionState = { ok: true } | { error: string } | null;

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

interface LaunchWindow {
  date_start: string | null;
  date_end: string | null;
  closed_at: string | null;
}

/**
 * Loads the launch's window state for the append-only guards. Returns null if
 * the launch doesn't exist or RLS hid it from the caller — the daily action
 * surfaces that as a generic "no se encontró" error.
 */
async function loadLaunchWindow(
  supabase: SupabaseServerClient,
  launchId: string,
): Promise<LaunchWindow | null> {
  const { data } = await supabase
    .from("launches")
    .select("date_start, date_end, closed_at")
    .eq("id", launchId)
    .maybeSingle();
  return (data as LaunchWindow | null) ?? null;
}

/**
 * launch_daily is append-only, but the upsert by (launch_id, date) still has
 * to respect two business invariants:
 *   1. The date must fall inside [date_start, date_end] when those are set.
 *   2. The launch must not be closed.
 * These run on every write (insert + update). Phase 3 sync will reuse the same
 * checks server-side so external APIs can't bypass them.
 */
function validateAgainstWindow(
  window: LaunchWindow,
  date: string,
): { ok: true } | { ok: false; error: string } {
  if (window.closed_at) {
    return {
      ok: false,
      error: "El lanzamiento está cerrado. Reabrilo para cargar nuevos datos.",
    };
  }
  if (window.date_start && date < window.date_start) {
    return {
      ok: false,
      error: `La fecha está antes del inicio del lanzamiento (${window.date_start}).`,
    };
  }
  if (window.date_end && date > window.date_end) {
    return {
      ok: false,
      error: `La fecha está después del fin del lanzamiento (${window.date_end}).`,
    };
  }
  return { ok: true };
}

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
  await requireCanEditLaunchesIn(projectId);

  const parsed = parseFromForm(formData);
  if (!parsed.ok) return { error: parsed.error };
  if (isAllZero(parsed.payload)) {
    return { error: "Cargá leads en al menos un canal." };
  }

  const supabase = await createClient();
  const window = await loadLaunchWindow(supabase, launchId);
  if (!window) return { error: "No se encontró el lanzamiento." };

  const windowCheck = validateAgainstWindow(window, parsed.payload.date);
  if (!windowCheck.ok) return { error: windowCheck.error };

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
  await requireCanEditLaunchesIn(projectId);

  const parsed = parseFromForm(formData);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();
  const window = await loadLaunchWindow(supabase, launchId);
  if (!window) return { error: "No se encontró el lanzamiento." };

  const windowCheck = validateAgainstWindow(window, parsed.payload.date);
  if (!windowCheck.ok) return { error: windowCheck.error };

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
  await requireCanEditLaunchesIn(projectId);

  const supabase = await createClient();
  // Closed launches are frozen — no edits, no deletes — to match the same
  // invariant the sync engine (Phase 3) will use.
  const window = await loadLaunchWindow(supabase, launchId);
  if (window?.closed_at) return;

  await supabase
    .from("launch_daily")
    .delete()
    .eq("id", entryId)
    .eq("launch_id", launchId);

  revalidatePath(`/proyectos/${projectId}/launches/${launchId}`);
}
