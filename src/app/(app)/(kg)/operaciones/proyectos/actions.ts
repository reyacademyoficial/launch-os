"use server";

import { revalidatePath } from "next/cache";

import {
  markPushPending,
  pushProjectToNotion,
} from "@/lib/notion/push-project";
import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

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

export type UpdateProjectState =
  /**
   * `warning` aparece cuando el proyecto viene de Notion y el write-back
   * falló: el guardado local SÍ se hizo, y el cambio queda marcado como
   * pendiente para que el sync lo reintente sin pisarlo. Ver 0176.
   */
  | { ok: true; warning?: string }
  | { error: string }
  | null;

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
  /** Personas responsables. Dedupeadas. Vacío = proyecto sin dueños. */
  readonly ownerIds: string[];
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

  // Multi-select: los checkboxes envían N valores con el mismo name.
  const rawOwnerIds = formData.getAll("owner_ids");
  const ownerIds: string[] = [];
  const seenOwners = new Set<string>();
  for (const v of rawOwnerIds) {
    const s = String(v).trim();
    if (s.length === 0 || seenOwners.has(s)) continue;
    seenOwners.add(s);
    ownerIds.push(s);
  }

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
    ownerIds,
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

  // Popular la junction si hay owners seleccionados.
  if (parsed.ownerIds.length > 0) {
    const ownerRows = parsed.ownerIds.map((personId) => ({
      internal_project_id: created.id,
      person_id: personId,
      organization_id: organizationId,
    }));
    const { error: ownersErr } = await supabase
      .from("internal_project_owners")
      .insert(ownerRows as never);
    if (ownersErr) {
      // El project ya existe pero los owners fallaron. Devolvemos error
      // igual — el operador puede editar y reintentar. No rollbackeamos
      // el project (no vale la complejidad para este caso raro).
      return { error: `Proyecto creado pero fallaron los owners: ${ownersErr.message}` };
    }
  }

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
    .select("closed_at, organization_id, notion_page_id")
    .eq("id", projectId)
    .maybeSingle();
  const existingRow = existing as
    | {
        closed_at: string | null;
        organization_id: string;
        notion_page_id: string | null;
      }
    | null;
  if (!existingRow) return { error: "Proyecto no encontrado." };
  const prevClosedAt = existingRow.closed_at;
  const organizationId = existingRow.organization_id;
  const isNotionSourced = !!existingRow.notion_page_id;

  const nextIsClosed = CLOSED_STATUSES.has(parsed.status);
  const closedAt = nextIsClosed
    ? (prevClosedAt ?? new Date().toISOString())
    : null;

  const payload = {
    name: parsed.name,
    description: parsed.description,
    status: parsed.status,
    priority: parsed.priority,
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

  // Reemplazar el set de owners: delete + insert bulk. Es un reemplazo
  // atómico (borra los que se sacaron, mete los nuevos) más simple que
  // diff-ear el set previo. El costo es N filas nuevas cada guardado
  // pero N es chico (< 20 típico).
  const { error: delErr } = await supabase
    .from("internal_project_owners")
    .delete()
    .eq("internal_project_id", projectId);
  if (delErr) return { error: `Owners no se pudieron reemplazar: ${delErr.message}` };

  if (parsed.ownerIds.length > 0) {
    const ownerRows = parsed.ownerIds.map((personId) => ({
      internal_project_id: projectId,
      person_id: personId,
      organization_id: organizationId,
    }));
    const { error: insErr } = await supabase
      .from("internal_project_owners")
      .insert(ownerRows as never);
    if (insErr) return { error: `Owners nuevos fallaron: ${insErr.message}` };
  }

  // ─── Write-back a Notion (0176) ──────────────────────────────────────
  //
  // Sin esto el guardado dura hasta el próximo sync: Notion sigue con el
  // valor viejo y lo vuelve a imponer. Marcamos el cambio como pendiente
  // ANTES de intentar el push, así una caída entre medio deja el proyecto
  // protegido (el sync no lo pisa y reintenta) en vez de perder el cambio.
  //
  // Service client: el RLS de `notion_workspaces` (0132) restringe el token
  // a superadmin, y cualquier operador con permiso de editar proyectos tiene
  // que poder marcar "listo". El push no expone nada del workspace al
  // browser — solo devuelve ok/error.
  let warning: string | undefined;
  if (isNotionSourced) {
    const service = createServiceClient();
    await markPushPending(service, projectId);
    const pushed = await pushProjectToNotion(projectId, service);
    if (!pushed.ok) {
      warning =
        `Se guardó en KG, pero no pudimos escribir el cambio en Notion: ${pushed.error} ` +
        "El proyecto queda protegido (el sync no lo va a revertir) y se reintenta solo.";
    }
  }

  revalidatePath("/operaciones/proyectos");
  revalidatePath(`/operaciones/proyectos/${projectId}`);
  revalidatePath("/operaciones");
  return warning ? { ok: true, warning } : { ok: true };
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
