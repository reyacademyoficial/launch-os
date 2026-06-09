"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireCanEditLaunchesIn, requireCanEditProject } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export type LaunchActionState = { ok: true } | { error: string } | null;

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
  launch_date: string | null;
  dur_captacion: number;
  dur_calentamiento: number;
  dur_compra: number;
  dur_cierre: number;
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

// Defaults espejados con DEFAULT_DURATIONS / la migración 0011. Inline para
// no arrastrar el módulo del calendario adentro de un archivo "use server".
const DEFAULT_DUR_CAPTACION = 21;
const DEFAULT_DUR_CALENTAMIENTO = 14;
const DEFAULT_DUR_COMPRA = 5;
const DEFAULT_DUR_CIERRE = 3;

function intWithDefault(formData: FormData, key: string, fallback: number): number {
  const v = str(formData, key);
  if (v === "") return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function parseLaunchFromForm(
  formData: FormData,
): { ok: true; payload: LaunchWritePayload } | { ok: false; error: string } {
  const name = str(formData, "name");
  if (!name) return { ok: false, error: "El nombre es obligatorio." };

  // launch_date es opcional — un launch puede crearse sin fecha definida.
  // Cuando se setea, las durations alimentan el cálculo GENERATED de
  // date_start/date_end en la DB. NO escribimos date_start/date_end —
  // son columnas generadas.
  const launchDate = str(formData, "launch_date") || null;

  return {
    ok: true,
    payload: {
      name,
      launch_date: launchDate,
      dur_captacion: intWithDefault(formData, "dur_captacion", DEFAULT_DUR_CAPTACION),
      dur_calentamiento: intWithDefault(
        formData,
        "dur_calentamiento",
        DEFAULT_DUR_CALENTAMIENTO,
      ),
      dur_compra: intWithDefault(formData, "dur_compra", DEFAULT_DUR_COMPRA),
      dur_cierre: intWithDefault(formData, "dur_cierre", DEFAULT_DUR_CIERRE),
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

  // Si el usuario eligió "Copiar conexiones de" en el modal, traemos config +
  // launch_secrets del launch fuente. Service-role para leer/escribir
  // launch_secrets (que está blindada). Si la copia falla NO bloqueamos el
  // create — el launch se creó OK, el usuario puede recargar las conexiones
  // a mano desde la sección Integraciones.
  const copyFromId = String(formData.get("copy_from_launch_id") ?? "").trim();
  if (copyFromId) {
    await copyConnectionsInline(projectId, copyFromId, id);
  }

  redirect(`/proyectos/${projectId}/launches/${id}`);
}

async function copyConnectionsInline(
  projectId: string,
  sourceLaunchId: string,
  targetLaunchId: string,
): Promise<void> {
  // Import inline para no arrastrar el service-role client en cada createLaunch
  // — solo cuando hace falta.
  const { createServiceClient } = await import("@/lib/supabase/service");
  const service = createServiceClient();

  const sourceRes = await service
    .from("launches")
    .select("project_id, integration_config")
    .eq("id", sourceLaunchId)
    .maybeSingle();
  const source = sourceRes.data as
    | { project_id: string; integration_config: unknown }
    | null;
  // Guard de URL tampering: si el source es de otro proyecto, no copiamos.
  if (!source || source.project_id !== projectId) return;

  const cfgPayload = {
    integration_config: source.integration_config ?? {},
  } as never;
  await service.from("launches").update(cfgPayload).eq("id", targetLaunchId);

  const secretsRes = await service
    .from("launch_secrets")
    .select("provider, secret")
    .eq("launch_id", sourceLaunchId);
  const secrets =
    (secretsRes.data ?? []) as Array<{ provider: string; secret: string }>;
  if (secrets.length > 0) {
    const rows = secrets.map((s) => ({
      launch_id: targetLaunchId,
      provider: s.provider,
      secret: s.secret,
    }));
    await service
      .from("launch_secrets")
      .upsert(rows as never, { onConflict: "launch_id,provider" });
  }
}

/**
 * Updates an existing launch. Gate is launch-scope: admin/superadmin on the
 * project pass, and operadores assigned to this launch with `can_edit = true`
 * pass too. Analista and cliente never pass. The `eq("project_id", projectId)`
 * below is the URL-tampering guard (launch must belong to the URL's project).
 */
export async function updateLaunch(
  projectId: string,
  launchId: string,
  _prev: LaunchActionState,
  formData: FormData,
): Promise<LaunchActionState> {
  await requireCanEditLaunchesIn(projectId);

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

  // Devolvemos `ok: true` (sin redirect) para que el modal se cierre y la
  // misma URL re-renderice con los datos nuevos vía revalidatePath. Si el
  // usuario está en la página del detalle, la sección Calendario y el KpiGrid
  // muestran lo nuevo sin navegar.
  revalidatePath(`/proyectos/${projectId}/launches/${launchId}`);
  return { ok: true };
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

/**
 * Duplicates a launch within the same project. The clone gets a fresh id,
 * "Copia de <name>" as its name, no daily entries, and closed_at = NULL so
 * it starts open. All metric fields and platforms carry over so the user can
 * adjust from a known baseline.
 */
export async function duplicateLaunch(
  projectId: string,
  launchId: string,
): Promise<void> {
  await requireCanEditProject(projectId);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("launches")
    .select("*")
    .eq("id", launchId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (error || !data) return;

  // Strip identity + audit columns + generated columns (date_start, date_end
  // se calculan en la DB y no se pueden insertar explícitamente). Forzamos
  // closed_at=NULL para que el clon arranque abierto.
  const source = data as Record<string, unknown>;
  const {
    id: _id,
    created_at: _createdAt,
    updated_at: _updatedAt,
    date_start: _dateStart,
    date_end: _dateEnd,
    name: sourceName,
    ...rest
  } = source;
  void _id;
  void _createdAt;
  void _updatedAt;
  void _dateStart;
  void _dateEnd;

  const insertPayload = {
    ...rest,
    name: `Copia de ${sourceName as string}`,
    closed_at: null,
  } as never;

  const { data: inserted, error: insertError } = await supabase
    .from("launches")
    .insert(insertPayload)
    .select("id")
    .maybeSingle();

  if (insertError || !inserted) return;

  const newId = (inserted as { id: string }).id;
  // Después del clon redirigimos al detalle del nuevo launch — desde ahí el
  // usuario abre el modal de Editar si quiere ajustar. (Cuando el flow era
  // página dedicada `/edit`, redirigíamos directo a ese URL.)
  redirect(`/proyectos/${projectId}/launches/${newId}`);
}

/**
 * Closes a launch — sets closed_at = now(). A closed launch rejects new daily
 * data (see daily-actions). In Phase 3 the integrations sync engine will also
 * stop polling once a launch is closed. Launch-scope gate so operadores
 * assigned with can_edit can close their own launches.
 */
export async function closeLaunch(projectId: string, launchId: string): Promise<void> {
  await requireCanEditLaunchesIn(projectId);

  const supabase = await createClient();
  const payload = { closed_at: new Date().toISOString() } as never;
  await supabase
    .from("launches")
    .update(payload)
    .eq("id", launchId)
    .eq("project_id", projectId);

  revalidatePath(`/proyectos/${projectId}/launches/${launchId}`);
}

/**
 * Reopens a closed launch — clears closed_at. Same permission gate as close.
 */
export async function reopenLaunch(projectId: string, launchId: string): Promise<void> {
  await requireCanEditLaunchesIn(projectId);

  const supabase = await createClient();
  const payload = { closed_at: null } as never;
  await supabase
    .from("launches")
    .update(payload)
    .eq("id", launchId)
    .eq("project_id", projectId);

  revalidatePath(`/proyectos/${projectId}/launches/${launchId}`);
}
