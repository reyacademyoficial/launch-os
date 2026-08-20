"use server";

import { revalidatePath } from "next/cache";

import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// CRUD de tasks (bloque 5 · 0092 + 0138 status/priority alineados a Notion).
//
// El schema no tiene invariante entre status='listo' ↔ completed_at. La app
// lo maneja transparentemente:
//   - Nuevo status listo sin completed_at previo → se setea now().
//   - Vuelve a un status abierto → completed_at pasa a null.
//   - Cerrada con completed_at ya seteado → se preserva.
// Mismo patrón que tickets.resolved_at y internal_projects.closed_at.
//
// Delete es hard sin guard — las tasks no tienen tablas dependientes
// críticas (checklists y blockers cascadeacan, time_entries sobreviven
// con task_id null). Confirm client-side.
// ═══════════════════════════════════════════════════════════════════════════

const STATUSES = [
  "sin_empezar",
  "en_proceso",
  "bloqueado",
  "alerta_maxima",
  "listo",
] as const;
const PRIORITIES = ["alta", "media", "baja"] as const;

type Status = (typeof STATUSES)[number];
type Priority = (typeof PRIORITIES)[number];

const CLOSED_STATUSES: ReadonlySet<Status> = new Set(["listo"]);

export type CreateTaskState =
  | { ok: true; taskId: string }
  | { error: string }
  | null;

export type UpdateTaskState = { ok: true } | { error: string } | null;

export type DeleteTaskResult = { ok: true } | { error: string };

const YMD_RX = /^\d{4}-\d{2}-\d{2}$/;

function nullIfEmpty(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

interface TaskPayload {
  readonly title: string;
  readonly description: string | null;
  readonly status: Status;
  readonly priority: Priority;
  readonly internalProjectId: string | null;
  readonly assigneeId: string | null;
  readonly dueOn: string | null;
}

function parseTaskFormData(formData: FormData): TaskPayload | string {
  const title = String(formData.get("title") ?? "").trim();
  if (title.length === 0) return "El título es obligatorio.";
  if (title.length > 300) return "El título es demasiado largo (máximo 300 caracteres).";

  const description = nullIfEmpty(formData.get("description"));

  const statusRaw = String(formData.get("status") ?? "").trim();
  if (!(STATUSES as readonly string[]).includes(statusRaw)) {
    return "Estado inválido.";
  }
  const status = statusRaw as Status;

  const priorityRaw = String(formData.get("priority") ?? "").trim();
  if (!(PRIORITIES as readonly string[]).includes(priorityRaw)) {
    return "Prioridad inválida.";
  }
  const priority = priorityRaw as Priority;

  const internalProjectId = nullIfEmpty(formData.get("internal_project_id"));
  const assigneeId = nullIfEmpty(formData.get("assignee_id"));

  const dueOn = nullIfEmpty(formData.get("due_on"));
  if (dueOn != null && !YMD_RX.test(dueOn)) {
    return "La fecha de vencimiento no es válida.";
  }

  return {
    title,
    description,
    status,
    priority,
    internalProjectId,
    assigneeId,
    dueOn,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// createTask
// ═══════════════════════════════════════════════════════════════════════════

export async function createTask(
  _prev: CreateTaskState,
  formData: FormData,
): Promise<CreateTaskState> {
  const parsed = parseTaskFormData(formData);
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

  const completedAt = CLOSED_STATUSES.has(parsed.status)
    ? new Date().toISOString()
    : null;

  const supabase = await createSupabaseClient();
  const payload = {
    organization_id: organizationId,
    title: parsed.title,
    description: parsed.description,
    status: parsed.status,
    priority: parsed.priority,
    internal_project_id: parsed.internalProjectId,
    assignee_id: parsed.assigneeId,
    due_on: parsed.dueOn,
    completed_at: completedAt,
  } as never;

  const { data, error } = await supabase
    .from("tasks")
    .insert(payload)
    .select("id")
    .single();

  if (error) return { error: error.message };

  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath("/operaciones/tareas");
  revalidatePath("/operaciones");
  if (parsed.internalProjectId) {
    revalidatePath(`/operaciones/proyectos/${parsed.internalProjectId}`);
    revalidatePath("/operaciones/proyectos");
  }
  return { ok: true, taskId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateTask
// ═══════════════════════════════════════════════════════════════════════════

export async function updateTask(
  taskId: string,
  _prev: UpdateTaskState,
  formData: FormData,
): Promise<UpdateTaskState> {
  if (!taskId) return { error: "Falta el id de la tarea." };

  const parsed = parseTaskFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();

  const { data: existing } = await supabase
    .from("tasks")
    .select("completed_at, internal_project_id")
    .eq("id", taskId)
    .maybeSingle();
  const prev = existing as {
    completed_at: string | null;
    internal_project_id: string | null;
  } | null;
  const prevCompletedAt = prev?.completed_at ?? null;
  const prevProjectId = prev?.internal_project_id ?? null;

  const nextIsClosed = CLOSED_STATUSES.has(parsed.status);
  const completedAt = nextIsClosed
    ? (prevCompletedAt ?? new Date().toISOString())
    : null;

  const payload = {
    title: parsed.title,
    description: parsed.description,
    status: parsed.status,
    priority: parsed.priority,
    internal_project_id: parsed.internalProjectId,
    assignee_id: parsed.assigneeId,
    due_on: parsed.dueOn,
    completed_at: completedAt,
  } as never;

  const { error } = await supabase
    .from("tasks")
    .update(payload)
    .eq("id", taskId);

  if (error) return { error: error.message };

  revalidatePath("/operaciones/tareas");
  revalidatePath("/operaciones");
  if (parsed.internalProjectId) {
    revalidatePath(`/operaciones/proyectos/${parsed.internalProjectId}`);
  }
  if (prevProjectId && prevProjectId !== parsed.internalProjectId) {
    revalidatePath(`/operaciones/proyectos/${prevProjectId}`);
  }
  revalidatePath("/operaciones/proyectos");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// deleteTask — hard delete con confirm client-side
// ═══════════════════════════════════════════════════════════════════════════

export async function deleteTask(
  taskId: string,
): Promise<DeleteTaskResult> {
  if (!taskId) return { error: "Falta el id de la tarea." };

  const supabase = await createSupabaseClient();

  const { data: existing } = await supabase
    .from("tasks")
    .select("internal_project_id")
    .eq("id", taskId)
    .maybeSingle();
  const projectId = (
    existing as { internal_project_id: string | null } | null
  )?.internal_project_id;

  const { error } = await supabase.from("tasks").delete().eq("id", taskId);
  if (error) return { error: error.message };

  revalidatePath("/operaciones/tareas");
  revalidatePath("/operaciones");
  if (projectId) {
    revalidatePath(`/operaciones/proyectos/${projectId}`);
    revalidatePath("/operaciones/proyectos");
  }
  return { ok: true };
}
