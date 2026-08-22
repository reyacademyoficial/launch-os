"use server";

import { revalidatePath } from "next/cache";

import {
  createExternalApp,
  deleteExternalApp,
  updateExternalApp,
  type ExternalAppAuthStrategy,
  type ExternalAppConfig,
} from "@/lib/academia/external-apps";

// ═══════════════════════════════════════════════════════════════════════════
// Server actions para external_apps (Fase G · 0153).
//
// El gating fino vive en RLS (can_edit_project). project_id NO se denormaliza
// desde ningún parent — el usuario elige el proyecto al crear la app.
// ═══════════════════════════════════════════════════════════════════════════

export type UpsertExternalAppState =
  | { ok: true; appId: string }
  | { error: string }
  | null;

export type DeleteExternalAppResult = { ok: true } | { error: string };

const STRATEGIES: readonly ExternalAppAuthStrategy[] = [
  "jwt",
  "shared_secret",
  "oauth2",
  "magic_link",
];

function nullIfEmpty(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

function parseName(raw: FormDataEntryValue | null): string | null {
  const trimmed = String(raw ?? "").trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 120) return null;
  return trimmed;
}

function parseBaseUrl(raw: FormDataEntryValue | null): string | null {
  const trimmed = String(raw ?? "").trim();
  if (trimmed.length === 0) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

/**
 * Construye ExternalAppConfig desde los campos del form. Solo incluye los
 * que están seteados — no forzamos defaults acá (los defaults viven en el
 * SSO helper para poder cambiarlos sin migración).
 */
function buildConfig(formData: FormData): ExternalAppConfig {
  const config: Record<string, unknown> = {};
  const secret = nullIfEmpty(formData.get("config_secret"));
  const magicEp = nullIfEmpty(formData.get("config_magic_link_endpoint"));
  const tokenParam = nullIfEmpty(formData.get("config_token_param"));
  const tokenPlacementRaw = nullIfEmpty(formData.get("config_token_placement"));
  const issuer = nullIfEmpty(formData.get("config_issuer"));
  const audience = nullIfEmpty(formData.get("config_audience"));
  const expiresRaw = nullIfEmpty(formData.get("config_expires_in_seconds"));

  if (secret) config.secret = secret;
  if (magicEp) config.magic_link_endpoint = magicEp;
  if (tokenParam) config.token_param = tokenParam;
  if (tokenPlacementRaw === "hash" || tokenPlacementRaw === "query") {
    config.token_placement = tokenPlacementRaw;
  }
  if (issuer) config.issuer = issuer;
  if (audience) config.audience = audience;
  if (expiresRaw) {
    const n = Number(expiresRaw);
    if (Number.isFinite(n) && n > 0 && n <= 3600) {
      config.expires_in_seconds = Math.floor(n);
    }
  }
  return config as ExternalAppConfig;
}

// ═══════════════════════════════════════════════════════════════════════════
// createExternalAppAction
// ═══════════════════════════════════════════════════════════════════════════

export async function createExternalAppAction(
  _prev: UpsertExternalAppState,
  formData: FormData,
): Promise<UpsertExternalAppState> {
  const projectId = nullIfEmpty(formData.get("project_id"));
  if (!projectId) return { error: "Elegí un proyecto." };

  const name = parseName(formData.get("name"));
  if (name == null) {
    return { error: "El nombre es obligatorio (máximo 120 caracteres)." };
  }
  const baseUrl = parseBaseUrl(formData.get("base_url"));
  if (baseUrl == null) {
    return { error: "La URL base debe ser una URL válida (http/https)." };
  }
  const strategyRaw = nullIfEmpty(formData.get("auth_strategy"));
  if (
    !strategyRaw ||
    !(STRATEGIES as readonly string[]).includes(strategyRaw)
  ) {
    return {
      error:
        "auth_strategy inválida (jwt | shared_secret | oauth2 | magic_link).",
    };
  }
  const config = buildConfig(formData);

  try {
    const row = await createExternalApp({
      project_id: projectId,
      name,
      base_url: baseUrl,
      auth_strategy: strategyRaw as ExternalAppAuthStrategy,
      config,
    });
    revalidatePath("/academia/apps-externas");
    return { ok: true, appId: row.id };
  } catch (e) {
    return { error: translateDbError(e) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// updateExternalAppAction
// ═══════════════════════════════════════════════════════════════════════════

export async function updateExternalAppAction(
  appId: string,
  _prev: UpsertExternalAppState,
  formData: FormData,
): Promise<UpsertExternalAppState> {
  if (!appId) return { error: "Falta el id de la app." };

  const name = parseName(formData.get("name"));
  if (name == null) {
    return { error: "El nombre es obligatorio (máximo 120 caracteres)." };
  }
  const baseUrl = parseBaseUrl(formData.get("base_url"));
  if (baseUrl == null) {
    return { error: "La URL base debe ser una URL válida (http/https)." };
  }
  const strategyRaw = nullIfEmpty(formData.get("auth_strategy"));
  if (
    !strategyRaw ||
    !(STRATEGIES as readonly string[]).includes(strategyRaw)
  ) {
    return {
      error:
        "auth_strategy inválida (jwt | shared_secret | oauth2 | magic_link).",
    };
  }
  const activeRaw = formData.get("active");
  const active = activeRaw === null ? true : String(activeRaw) === "on";
  const config = buildConfig(formData);

  try {
    await updateExternalApp(appId, {
      name,
      base_url: baseUrl,
      auth_strategy: strategyRaw as ExternalAppAuthStrategy,
      config,
      active,
    });
    revalidatePath("/academia/apps-externas");
    return { ok: true, appId };
  } catch (e) {
    return { error: translateDbError(e) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// deleteExternalAppAction
//
// courses.external_app_id ON DELETE SET NULL (migración 0153) — los cursos
// que apuntan a esta app quedan sin app asociada, sin romperse.
// ═══════════════════════════════════════════════════════════════════════════

export async function deleteExternalAppAction(
  appId: string,
): Promise<DeleteExternalAppResult> {
  if (!appId) return { error: "Falta el id de la app." };
  try {
    await deleteExternalApp(appId);
    revalidatePath("/academia/apps-externas");
    return { ok: true };
  } catch (e) {
    return { error: translateDbError(e) };
  }
}

function translateDbError(e: unknown): string {
  const err = e as { code?: string; message?: string } | null;
  if (!err) return "Error desconocido";
  if (err.code === "23505") {
    return "Ya existe una app con ese nombre en el proyecto.";
  }
  if (err.code === "23514") {
    if (err.message?.includes("propia")) {
      return "El proyecto no es 'propia'. Apps externas solo aplican a proyectos propios.";
    }
    return err.message ?? "Violación de constraint.";
  }
  if (err.code === "42501") {
    return "No tenés permisos para editar apps externas en este proyecto.";
  }
  return err.message ?? "Error al guardar";
}
