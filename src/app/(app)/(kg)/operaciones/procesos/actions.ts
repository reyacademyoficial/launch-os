"use server";

import { revalidatePath } from "next/cache";

import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// CRUD de processes (bloque 5 · 0094).
//
// SOPs Markdown. slug es opcional pero unique case-insensitive por org
// cuando está seteado. version se incrementa MANUALMENTE cuando el
// operador considera que hubo un cambio importante (YAGNI: sin tabla
// de revisions).
//
// Delete es hard con confirm — un process no tiene dependientes en otras
// tablas. Los que se quieren "sacar de vista sin perder" se archivan
// (active=false).
// ═══════════════════════════════════════════════════════════════════════════

export type CreateProcessState =
  | { ok: true; processId: string }
  | { error: string }
  | null;

export type UpdateProcessState = { ok: true } | { error: string } | null;

export type DeleteProcessResult = { ok: true } | { error: string };

const SLUG_RX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function nullIfEmpty(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

interface ProcessPayload {
  readonly title: string;
  readonly slug: string | null;
  readonly contentMd: string;
  readonly category: string | null;
  readonly version: number;
  readonly active: boolean;
}

function parseProcessFormData(
  formData: FormData,
  { defaultActive }: { defaultActive: boolean },
): ProcessPayload | string {
  const title = String(formData.get("title") ?? "").trim();
  if (title.length === 0) return "El título es obligatorio.";
  if (title.length > 300) return "El título es demasiado largo (máximo 300 caracteres).";

  const slugRaw = nullIfEmpty(formData.get("slug"));
  let slug: string | null = null;
  if (slugRaw != null) {
    const lower = slugRaw.toLowerCase();
    if (!SLUG_RX.test(lower)) {
      return "El slug solo puede tener letras minúsculas, números y guiones (ej. onboarding-cliente).";
    }
    slug = lower;
  }

  const contentMd = String(formData.get("content_md") ?? "");

  const category = nullIfEmpty(formData.get("category"));

  const versionRaw = String(formData.get("version") ?? "1").trim();
  const versionNum = Number(versionRaw);
  if (!Number.isFinite(versionNum) || versionNum < 1 || !Number.isInteger(versionNum)) {
    return "La versión tiene que ser un entero ≥ 1.";
  }

  const activeRaw = formData.get("active");
  const active =
    activeRaw === null ? defaultActive : String(activeRaw) === "on";

  return {
    title,
    slug,
    contentMd,
    category,
    version: versionNum,
    active,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// createProcess
// ═══════════════════════════════════════════════════════════════════════════

export async function createProcess(
  _prev: CreateProcessState,
  formData: FormData,
): Promise<CreateProcessState> {
  const parsed = parseProcessFormData(formData, { defaultActive: true });
  if (typeof parsed === "string") return { error: parsed };

  let organizationId: string | null;
  try {
    organizationId = await resolveCurrentOrganizationId();
  } catch (e) {
    return {
      error:
        e instanceof Error ? e.message : "Error resolviendo la organización.",
    };
  }
  if (!organizationId) {
    return { error: "No pudimos resolver tu organización. Revisá tus permisos." };
  }

  const supabase = await createSupabaseClient();
  const payload = {
    organization_id: organizationId,
    title: parsed.title,
    slug: parsed.slug,
    content_md: parsed.contentMd,
    category: parsed.category,
    version: parsed.version,
    active: parsed.active,
  } as never;

  const { data, error } = await supabase
    .from("processes")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        error:
          "Ya existe otro proceso con ese slug en la organización. Cambialo o dejalo vacío.",
      };
    }
    return { error: error.message };
  }

  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath("/operaciones/procesos");
  return { ok: true, processId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateProcess
// ═══════════════════════════════════════════════════════════════════════════

export async function updateProcess(
  processId: string,
  _prev: UpdateProcessState,
  formData: FormData,
): Promise<UpdateProcessState> {
  if (!processId) return { error: "Falta el id del proceso." };

  const parsed = parseProcessFormData(formData, { defaultActive: true });
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();
  const payload = {
    title: parsed.title,
    slug: parsed.slug,
    content_md: parsed.contentMd,
    category: parsed.category,
    version: parsed.version,
    active: parsed.active,
  } as never;

  const { error } = await supabase
    .from("processes")
    .update(payload)
    .eq("id", processId);

  if (error) {
    if (error.code === "23505") {
      return {
        error: "Ya existe otro proceso con ese slug en la organización.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/operaciones/procesos");
  revalidatePath(`/operaciones/procesos/${processId}`);
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// deleteProcess — hard delete con confirm
// ═══════════════════════════════════════════════════════════════════════════

export async function deleteProcess(
  processId: string,
): Promise<DeleteProcessResult> {
  if (!processId) return { error: "Falta el id del proceso." };

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("processes")
    .delete()
    .eq("id", processId);
  if (error) return { error: error.message };

  revalidatePath("/operaciones/procesos");
  return { ok: true };
}
