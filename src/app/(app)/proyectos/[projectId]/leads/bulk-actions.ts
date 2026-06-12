"use server";

import { revalidatePath } from "next/cache";

import { LEAD_STATUSES, type LeadStatus } from "@/lib/leads/types";
import { requireCanEditLaunchesIn } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Acciones masivas para la tabla a volumen:
 *   - promover / despromover al kanban
 *   - cambiar status en bulk
 *   - reasignar setter en bulk
 *
 * Todas reciben una lista de leadIds (los seleccionados en la tabla visible)
 * y aplican UN solo UPDATE filtrado por (project_id IN leadIds) — postgrest
 * lo convierte en un solo round-trip. RLS valida tenant y permiso.
 */

export type BulkResult = { ok: true; affected: number } | { error: string };

const MAX_BULK = 1000;

function sanitizeIds(raw: ReadonlyArray<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of raw) {
    if (typeof id !== "string") continue;
    const trimmed = id.trim();
    if (trimmed === "" || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= MAX_BULK) break;
  }
  return out;
}

export async function promoteLeadsToKanban(
  projectId: string,
  leadIds: ReadonlyArray<string>,
): Promise<BulkResult> {
  return await applyBulk(projectId, leadIds, { pinned_to_kanban: true });
}

export async function unpromoteLeadsFromKanban(
  projectId: string,
  leadIds: ReadonlyArray<string>,
): Promise<BulkResult> {
  return await applyBulk(projectId, leadIds, { pinned_to_kanban: false });
}

export async function bulkUpdateLeadStatus(
  projectId: string,
  leadIds: ReadonlyArray<string>,
  status: LeadStatus,
): Promise<BulkResult> {
  if (!(LEAD_STATUSES as readonly string[]).includes(status)) {
    return { error: "Status inválido." };
  }
  return await applyBulk(projectId, leadIds, { status });
}

export async function bulkAssignSetter(
  projectId: string,
  leadIds: ReadonlyArray<string>,
  teamMemberId: string | null,
): Promise<BulkResult> {
  return await applyBulk(projectId, leadIds, { team_member_id: teamMemberId });
}

async function applyBulk(
  projectId: string,
  rawIds: ReadonlyArray<string>,
  patch: Record<string, unknown>,
): Promise<BulkResult> {
  await requireCanEditLaunchesIn(projectId);

  const ids = sanitizeIds(rawIds);
  if (ids.length === 0) return { error: "No hay leads seleccionados." };

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("leads")
    .update(patch as never, { count: "exact" })
    .eq("project_id", projectId)
    .in("id", ids);

  if (error) return { error: error.message };

  revalidatePath(`/proyectos/${projectId}/leads`);
  return { ok: true, affected: count ?? 0 };
}
