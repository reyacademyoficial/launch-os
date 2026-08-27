"use server";

import { revalidatePath, updateTag } from "next/cache";

import {
  createExternalApp,
  deleteExternalApp,
  updateExternalApp,
} from "@/lib/academia/external-apps";
import { currentOrgTagsAcademia } from "@/lib/academia/reference";

async function bustExternalAppsCache(): Promise<void> {
  const tags = await currentOrgTagsAcademia();
  if (tags) updateTag(tags.externalApps);
}

// ═══════════════════════════════════════════════════════════════════════════
// Server actions para external_apps (Fase G · 0153 + simplificado en 0156).
//
// El gating fino vive en RLS (can_edit_project). project_id NO se denormaliza
// desde ningún parent — el usuario elige el proyecto al crear la app.
// ═══════════════════════════════════════════════════════════════════════════

export type UpsertExternalAppState =
  | { ok: true; appId: string }
  | { error: string }
  | null;

export type DeleteExternalAppResult = { ok: true } | { error: string };

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

  try {
    const row = await createExternalApp({
      project_id: projectId,
      name,
      base_url: baseUrl,
    });
    await bustExternalAppsCache();
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
  const activeRaw = formData.get("active");
  const active = activeRaw === null ? true : String(activeRaw) === "on";

  try {
    await updateExternalApp(appId, {
      name,
      base_url: baseUrl,
      active,
    });
    await bustExternalAppsCache();
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
    await bustExternalAppsCache();
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
