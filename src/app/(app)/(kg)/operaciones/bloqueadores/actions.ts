"use server";

import { revalidatePath } from "next/cache";

import { resolveCurrentPersonId } from "@/lib/ops/current-person";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// CRUD de blockers (bloque 5 · 0095).
//
// XOR duro: exactamente uno de task_id XOR internal_project_id (CHECK
// constraint). El drawer fuerza el XOR eligiendo tipo de parent, pero el
// action valida además — resistente a forms manipulados.
//
// Invariante DB: `resolved_by NOT NULL → resolved_at NOT NULL`. Al revés
// SÍ está permitido (resolver sin registrar quién). El drawer refleja
// esto: resolved_by solo se muestra si resolved_at está seteado.
//
// NO hay sync automático con tasks.status='blocked' — decisión del schema.
// El operador puede sugerirlo desde la UI ("¿marcar la tarea como
// bloqueada también?"), pero no se fuerza.
// ═══════════════════════════════════════════════════════════════════════════

export type CreateBlockerState =
  | { ok: true; blockerId: string }
  | { error: string }
  | null;

export type UpdateBlockerState = { ok: true } | { error: string } | null;

export type DeleteBlockerResult = { ok: true } | { error: string };

export type ResolveBlockerResult = { ok: true } | { error: string };

type ParentKind = "task" | "project";

const YMD_RX = /^\d{4}-\d{2}-\d{2}$/;

function nullIfEmpty(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

interface BlockerPayload {
  readonly parentKind: ParentKind;
  readonly taskId: string | null;
  readonly internalProjectId: string | null;
  readonly reason: string;
  readonly resolvedAt: string | null;
  readonly resolvedBy: string | null;
}

function parseBlockerFormData(formData: FormData): BlockerPayload | string {
  const parentKindRaw = String(formData.get("parent_kind") ?? "").trim();
  if (parentKindRaw !== "task" && parentKindRaw !== "project") {
    return "El bloqueador tiene que colgar de una tarea o de un proyecto.";
  }
  const parentKind = parentKindRaw as ParentKind;

  const parentId = nullIfEmpty(formData.get("parent_id"));
  if (parentId == null) {
    return parentKind === "task"
      ? "Elegí la tarea a la que aplica el bloqueador."
      : "Elegí el proyecto al que aplica el bloqueador.";
  }

  const taskId = parentKind === "task" ? parentId : null;
  const internalProjectId = parentKind === "project" ? parentId : null;

  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length === 0) return "El motivo es obligatorio.";
  if (reason.length > 2000) {
    return "El motivo es demasiado largo (máximo 2000 caracteres).";
  }

  // resolved_at: opcional, viene como YYYY-MM-DD desde date input. Lo
  // convertimos a mediodía UTC para no rebotar de día por timezone.
  const resolvedAtRaw = nullIfEmpty(formData.get("resolved_at"));
  let resolvedAt: string | null = null;
  if (resolvedAtRaw != null) {
    if (!YMD_RX.test(resolvedAtRaw)) {
      return "La fecha de resolución no es válida.";
    }
    resolvedAt = `${resolvedAtRaw}T12:00:00Z`;
  }

  // resolved_by requires resolved_at (schema CHECK). El drawer no muestra
  // resolved_by si resolved_at es null; validamos server-side igual.
  const resolvedBy = nullIfEmpty(formData.get("resolved_by"));
  if (resolvedBy != null && resolvedAt == null) {
    return "No podés registrar quién resolvió si no marcaste el bloqueador como resuelto.";
  }

  return {
    parentKind,
    taskId,
    internalProjectId,
    reason,
    resolvedAt,
    resolvedBy,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// createBlocker
// ═══════════════════════════════════════════════════════════════════════════

export async function createBlocker(
  _prev: CreateBlockerState,
  formData: FormData,
): Promise<CreateBlockerState> {
  const parsed = parseBlockerFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();
  const payload = {
    task_id: parsed.taskId,
    internal_project_id: parsed.internalProjectId,
    reason: parsed.reason,
    resolved_at: parsed.resolvedAt,
    resolved_by: parsed.resolvedBy,
  } as never;

  const { data, error } = await supabase
    .from("blockers")
    .insert(payload)
    .select("id")
    .single();

  if (error) return { error: error.message };

  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath("/operaciones/bloqueadores");
  revalidatePath("/operaciones");
  if (parsed.internalProjectId) {
    revalidatePath(`/operaciones/proyectos/${parsed.internalProjectId}`);
  }
  return { ok: true, blockerId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateBlocker
// ═══════════════════════════════════════════════════════════════════════════

export async function updateBlocker(
  blockerId: string,
  _prev: UpdateBlockerState,
  formData: FormData,
): Promise<UpdateBlockerState> {
  if (!blockerId) return { error: "Falta el id del bloqueador." };

  const parsed = parseBlockerFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();

  // Leemos el parent previo para revalidar la ficha vieja si cambió.
  const { data: existing } = await supabase
    .from("blockers")
    .select("internal_project_id")
    .eq("id", blockerId)
    .maybeSingle();
  const prevProjectId =
    (existing as { internal_project_id: string | null } | null)
      ?.internal_project_id ?? null;

  const payload = {
    task_id: parsed.taskId,
    internal_project_id: parsed.internalProjectId,
    reason: parsed.reason,
    resolved_at: parsed.resolvedAt,
    resolved_by: parsed.resolvedBy,
  } as never;

  const { error } = await supabase
    .from("blockers")
    .update(payload)
    .eq("id", blockerId);

  if (error) return { error: error.message };

  revalidatePath("/operaciones/bloqueadores");
  revalidatePath("/operaciones");
  if (parsed.internalProjectId) {
    revalidatePath(`/operaciones/proyectos/${parsed.internalProjectId}`);
  }
  if (prevProjectId && prevProjectId !== parsed.internalProjectId) {
    revalidatePath(`/operaciones/proyectos/${prevProjectId}`);
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// resolveBlocker — atajo: marca como resuelto ahora, por el user actual
//
// Setea resolved_at=now() y resolved_by=personId si el user tiene persona
// vinculada. Si no la tiene, resolved_by queda null (válido por el CHECK).
// ═══════════════════════════════════════════════════════════════════════════

export async function resolveBlocker(
  blockerId: string,
): Promise<ResolveBlockerResult> {
  if (!blockerId) return { error: "Falta el id del bloqueador." };

  const personId = await resolveCurrentPersonId();
  const supabase = await createSupabaseClient();

  const { data: existing } = await supabase
    .from("blockers")
    .select("internal_project_id")
    .eq("id", blockerId)
    .maybeSingle();
  const projectId =
    (existing as { internal_project_id: string | null } | null)
      ?.internal_project_id ?? null;

  const payload = {
    resolved_at: new Date().toISOString(),
    resolved_by: personId,
  } as never;

  const { error } = await supabase
    .from("blockers")
    .update(payload)
    .eq("id", blockerId);

  if (error) return { error: error.message };

  revalidatePath("/operaciones/bloqueadores");
  revalidatePath("/operaciones");
  if (projectId) revalidatePath(`/operaciones/proyectos/${projectId}`);
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// deleteBlocker — hard delete con confirm
// ═══════════════════════════════════════════════════════════════════════════

export async function deleteBlocker(
  blockerId: string,
): Promise<DeleteBlockerResult> {
  if (!blockerId) return { error: "Falta el id del bloqueador." };

  const supabase = await createSupabaseClient();

  const { data: existing } = await supabase
    .from("blockers")
    .select("internal_project_id")
    .eq("id", blockerId)
    .maybeSingle();
  const projectId =
    (existing as { internal_project_id: string | null } | null)
      ?.internal_project_id ?? null;

  const { error } = await supabase
    .from("blockers")
    .delete()
    .eq("id", blockerId);
  if (error) return { error: error.message };

  revalidatePath("/operaciones/bloqueadores");
  revalidatePath("/operaciones");
  if (projectId) revalidatePath(`/operaciones/proyectos/${projectId}`);
  return { ok: true };
}
