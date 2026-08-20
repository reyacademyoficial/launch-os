"use server";

import { revalidatePath } from "next/cache";

import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// CRUD de internal_projects (bloque 5 · 0090 + 0137 status alineado a Notion).
//
// El schema no impone invariante entre status='listo' ↔ closed_at. La app
// lo maneja transparentemente (mismo patrón que tickets.resolved_at y
// tasks.completed_at):
//   - Nuevo status listo sin closed_at previo → se setea now().
//   - Vuelve a un status abierto → closed_at null.
//   - status listo con closed_at ya seteado → se preserva.
// El operador no ve el campo — es contexto de reporting.
//
// DELETE con guard duro: si tiene tasks o time_entries se rechaza. El
// operador debería marcar como listo si quiere sacarlo de vista. checklists +
// blockers cascade — son sub-estructura pura del proyecto. Alineado con Clientes.
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

export type CreateProjectState =
  | { ok: true; projectId: string }
  | { error: string }
  | null;

export type UpdateProjectState = { ok: true } | { error: string } | null;

export type DeleteProjectResult = { ok: true } | { error: string };

const YMD_RX = /^\d{4}-\d{2}-\d{2}$/;

function nullIfEmpty(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

interface ProjectPayload {
  readonly name: string;
  readonly description: string | null;
  readonly status: Status;
  readonly priority: Priority;
  readonly ownerId: string | null;
  readonly startsOn: string | null;
  readonly dueOn: string | null;
  readonly notes: string | null;
}

function parseProjectFormData(formData: FormData): ProjectPayload | string {
  const name = String(formData.get("name") ?? "").trim();
  if (name.length === 0) return "El nombre es obligatorio.";
  if (name.length > 200) return "El nombre es demasiado largo (máximo 200 caracteres).";

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

  const ownerId = nullIfEmpty(formData.get("owner_id"));

  const startsOn = nullIfEmpty(formData.get("starts_on"));
  if (startsOn != null && !YMD_RX.test(startsOn)) {
    return "La fecha de inicio no es válida.";
  }
  const dueOn = nullIfEmpty(formData.get("due_on"));
  if (dueOn != null && !YMD_RX.test(dueOn)) {
    return "La fecha de vencimiento no es válida.";
  }
  if (startsOn != null && dueOn != null && dueOn < startsOn) {
    return "El vencimiento no puede ser anterior al inicio.";
  }

  const notes = nullIfEmpty(formData.get("notes"));

  return {
    name,
    description,
    status,
    priority,
    ownerId,
    startsOn,
    dueOn,
    notes,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// createProject
// ═══════════════════════════════════════════════════════════════════════════

export async function createProject(
  _prev: CreateProjectState,
  formData: FormData,
): Promise<CreateProjectState> {
  const parsed = parseProjectFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  let organizationId: string | null;
  try {
    organizationId = await resolveCurrentOrganizationId();
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Error resolviendo la organización.",
    };
  }
  if (!organizationId) {
    return { error: "No pudimos resolver tu organización. Revisá tus permisos." };
  }

  const closedAt = CLOSED_STATUSES.has(parsed.status)
    ? new Date().toISOString()
    : null;

  const supabase = await createSupabaseClient();
  const payload = {
    organization_id: organizationId,
    name: parsed.name,
    description: parsed.description,
    status: parsed.status,
    priority: parsed.priority,
    owner_id: parsed.ownerId,
    starts_on: parsed.startsOn,
    due_on: parsed.dueOn,
    closed_at: closedAt,
    notes: parsed.notes,
  } as never;

  const { data, error } = await supabase
    .from("internal_projects")
    .insert(payload)
    .select("id")
    .single();

  if (error) return { error: error.message };

  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath("/operaciones/proyectos");
  revalidatePath("/operaciones");
  return { ok: true, projectId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateProject
// ═══════════════════════════════════════════════════════════════════════════

export async function updateProject(
  projectId: string,
  _prev: UpdateProjectState,
  formData: FormData,
): Promise<UpdateProjectState> {
  if (!projectId) return { error: "Falta el id del proyecto." };

  const parsed = parseProjectFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();

  const { data: existing } = await supabase
    .from("internal_projects")
    .select("closed_at")
    .eq("id", projectId)
    .maybeSingle();
  const prevClosedAt =
    (existing as { closed_at: string | null } | null)?.closed_at ?? null;

  const nextIsClosed = CLOSED_STATUSES.has(parsed.status);
  const closedAt = nextIsClosed
    ? (prevClosedAt ?? new Date().toISOString())
    : null;

  const payload = {
    name: parsed.name,
    description: parsed.description,
    status: parsed.status,
    priority: parsed.priority,
    owner_id: parsed.ownerId,
    starts_on: parsed.startsOn,
    due_on: parsed.dueOn,
    closed_at: closedAt,
    notes: parsed.notes,
  } as never;

  const { error } = await supabase
    .from("internal_projects")
    .update(payload)
    .eq("id", projectId);

  if (error) return { error: error.message };

  revalidatePath("/operaciones/proyectos");
  revalidatePath(`/operaciones/proyectos/${projectId}`);
  revalidatePath("/operaciones");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// deleteProject — hard delete con guard duro
//
// Bloqueado si tiene tasks o time_entries: son datos de auditoría. El
// operador debería marcar como 'listo' en vez. checklists + blockers
// cascadeacan sin drama.
// ═══════════════════════════════════════════════════════════════════════════

export async function deleteProject(
  projectId: string,
): Promise<DeleteProjectResult> {
  if (!projectId) return { error: "Falta el id del proyecto." };

  const supabase = await createSupabaseClient();

  const [tasksRes, timeRes] = await Promise.all([
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("internal_project_id", projectId),
    supabase
      .from("time_entries")
      .select("id", { count: "exact", head: true })
      .eq("internal_project_id", projectId),
  ]);

  const deps: string[] = [];
  const tasksCount = tasksRes.count ?? 0;
  const timeCount = timeRes.count ?? 0;
  if (tasksCount > 0) {
    deps.push(`${tasksCount} tarea${tasksCount === 1 ? "" : "s"}`);
  }
  if (timeCount > 0) {
    deps.push(
      `${timeCount} registro${timeCount === 1 ? "" : "s"} de tiempo`,
    );
  }

  if (deps.length > 0) {
    return {
      error:
        `No se puede eliminar: el proyecto tiene ${deps.join(" y ")} colgadas. ` +
        "Marcalo como 'Listo' si querés sacarlo de vista sin perder historial.",
    };
  }

  const { error } = await supabase
    .from("internal_projects")
    .delete()
    .eq("id", projectId);
  if (error) return { error: error.message };

  revalidatePath("/operaciones/proyectos");
  revalidatePath("/operaciones");
  return { ok: true };
}
