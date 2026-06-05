"use server";

import { redirect } from "next/navigation";

import { requireCanEditProject } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export type LaunchActionState = { error: string } | null;

const VALID_TYPES = ["En Vivo", "Automatizado", "Replay"] as const;
const VALID_STATUS = ["Activo", "Escalando", "Finalizado", "Evergreen"] as const;
const VALID_PLATFORMS = ["Facebook", "Instagram", "Tiktok", "Youtube", "Email"] as const;

// ─── small FormData helpers ───────────────────────────────────────────────────

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function num(formData: FormData, key: string): number {
  const v = str(formData, key);
  if (v === "") return 0;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function int(formData: FormData, key: string): number {
  return Math.trunc(num(formData, key));
}

function nullable<T extends string>(value: string, allowed: readonly T[]): T | null {
  if (!value) return null;
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function parsePlatforms(formData: FormData): string[] {
  return formData
    .getAll("platforms")
    .map(String)
    .filter((p) => (VALID_PLATFORMS as readonly string[]).includes(p));
}

interface LaunchWritePayload {
  name: string;
  date: string | null;
  type: (typeof VALID_TYPES)[number] | null;
  status: (typeof VALID_STATUS)[number] | null;
  platforms: string[];
  meta_investment: number;
  meta_clicks: number;
  meta_leads: number;
  google_investment: number;
  google_clicks: number;
  google_leads: number;
  tiktok_investment: number;
  tiktok_clicks: number;
  tiktok_leads: number;
  contactos_api: number;
  ingresos_whatsapp: number;
  registrados: number;
  asistentes: number;
  hasta_pitch: number;
  ventas_total: number;
  ventas_mensuales: number;
  ventas_anuales: number;
  revenue: number;
}

function parseLaunchFromForm(
  formData: FormData,
): { ok: true; payload: LaunchWritePayload } | { ok: false; error: string } {
  const name = str(formData, "name");
  if (!name) return { ok: false, error: "El nombre es obligatorio." };

  const date = str(formData, "date");

  return {
    ok: true,
    payload: {
      name,
      date: date || null,
      type: nullable(str(formData, "type"), VALID_TYPES),
      status: nullable(str(formData, "status"), VALID_STATUS),
      platforms: parsePlatforms(formData),
      meta_investment: num(formData, "meta_investment"),
      meta_clicks: int(formData, "meta_clicks"),
      meta_leads: int(formData, "meta_leads"),
      google_investment: num(formData, "google_investment"),
      google_clicks: int(formData, "google_clicks"),
      google_leads: int(formData, "google_leads"),
      tiktok_investment: num(formData, "tiktok_investment"),
      tiktok_clicks: int(formData, "tiktok_clicks"),
      tiktok_leads: int(formData, "tiktok_leads"),
      contactos_api: int(formData, "contactos_api"),
      ingresos_whatsapp: num(formData, "ingresos_whatsapp"),
      registrados: int(formData, "registrados"),
      asistentes: int(formData, "asistentes"),
      hasta_pitch: int(formData, "hasta_pitch"),
      ventas_total: int(formData, "ventas_total"),
      ventas_mensuales: int(formData, "ventas_mensuales"),
      ventas_anuales: int(formData, "ventas_anuales"),
      revenue: num(formData, "revenue"),
    },
  };
}

// ─── actions ──────────────────────────────────────────────────────────────────

/**
 * Creates a launch in the given project, then redirects to its detail page.
 * The caller must be able to edit the project — re-checked here even though
 * the page already gated, because Server Actions are URL-invocable.
 */
export async function createLaunch(
  projectId: string,
  _prev: LaunchActionState,
  formData: FormData,
): Promise<LaunchActionState> {
  await requireCanEditProject(projectId);

  const parsed = parseLaunchFromForm(formData);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();
  // `as never` is the postgrest-js inference workaround (see memory
  // feedback_supabase_never_inference). Runtime payload matches the Insert shape.
  const insertPayload = { ...parsed.payload, project_id: projectId } as never;
  const { data, error } = await supabase
    .from("launches")
    .insert(insertPayload)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return { error: error?.message ?? "No se pudo crear el lanzamiento." };
  }

  const id = (data as { id: string }).id;
  redirect(`/proyectos/${projectId}/launches/${id}`);
}

/**
 * Updates an existing launch. Caller must be able to edit the project, and
 * the launch must belong to that project (URL tampering guard).
 */
export async function updateLaunch(
  projectId: string,
  launchId: string,
  _prev: LaunchActionState,
  formData: FormData,
): Promise<LaunchActionState> {
  await requireCanEditProject(projectId);

  const parsed = parseLaunchFromForm(formData);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();
  const updatePayload = parsed.payload as never;
  const { error } = await supabase
    .from("launches")
    .update(updatePayload)
    .eq("id", launchId)
    .eq("project_id", projectId);

  if (error) return { error: error.message };

  redirect(`/proyectos/${projectId}/launches/${launchId}`);
}

/**
 * Deletes a launch. Triggered by the DeleteButton's form action.
 */
export async function deleteLaunch(projectId: string, launchId: string): Promise<void> {
  await requireCanEditProject(projectId);

  const supabase = await createClient();
  await supabase
    .from("launches")
    .delete()
    .eq("id", launchId)
    .eq("project_id", projectId);

  redirect(`/proyectos/${projectId}/launches`);
}
