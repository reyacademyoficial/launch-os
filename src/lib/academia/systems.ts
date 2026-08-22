import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * academia_systems — sub-divisiones internas de un curso (migración 0150).
 *
 * Los sistemas cuelgan del CURSO. Ver docs/kingrow-academia-plan.md — Fase E.
 * project_id lo denormaliza el trigger de la DB; la UI no lo pasa.
 *
 * Tipos locales hasta que el codegen de supabase incluya la tabla.
 */

export interface AcademiaSystemRow {
  id: string;
  course_id: string;
  project_id: string;
  name: string;
  expert_team_member_id: string | null;
  color: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateSystemInput {
  course_id: string;
  name: string;
  color?: string | null;
  expert_team_member_id?: string | null;
  active?: boolean;
}

export interface UpdateSystemInput {
  name?: string;
  color?: string | null;
  expert_team_member_id?: string | null;
  active?: boolean;
}

export async function listSystemsByCourse(
  courseId: string,
): Promise<AcademiaSystemRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("academia_systems")
    .select("*")
    .eq("course_id", courseId)
    .order("active", { ascending: false })
    .order("name", { ascending: true });
  return (data ?? []) as unknown as AcademiaSystemRow[];
}

export async function getSystemById(
  systemId: string,
): Promise<AcademiaSystemRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("academia_systems")
    .select("*")
    .eq("id", systemId)
    .maybeSingle();
  return (data as unknown as AcademiaSystemRow | null) ?? null;
}

export async function createSystem(
  input: CreateSystemInput,
): Promise<AcademiaSystemRow> {
  const supabase = await createClient();

  // project_id se autocompleta por trigger — pasamos course_id como placeholder
  // (NOT NULL exige un valor). El trigger lo reemplaza por el project real.
  const payload = {
    course_id: input.course_id,
    project_id: input.course_id,
    name: input.name,
    color: input.color ?? null,
    expert_team_member_id: input.expert_team_member_id ?? null,
    active: input.active ?? true,
  } as unknown as never;

  const { data, error } = await supabase
    .from("academia_systems")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw error;
  return data as unknown as AcademiaSystemRow;
}

export async function updateSystem(
  systemId: string,
  input: UpdateSystemInput,
): Promise<AcademiaSystemRow> {
  const supabase = await createClient();
  const payload = {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.color !== undefined && { color: input.color }),
    ...(input.expert_team_member_id !== undefined && {
      expert_team_member_id: input.expert_team_member_id,
    }),
    ...(input.active !== undefined && { active: input.active }),
  } as unknown as never;

  const { data, error } = await supabase
    .from("academia_systems")
    .update(payload)
    .eq("id", systemId)
    .select("*")
    .single();

  if (error) throw error;
  return data as unknown as AcademiaSystemRow;
}

export async function deleteSystem(systemId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("academia_systems")
    .delete()
    .eq("id", systemId);
  if (error) throw error;
}

/**
 * Asigna (o desasigna con null) un experto team_member a un sistema. El
 * team_member vive en la misma org que el proyecto del curso (org-scope
 * post 0124). No validamos org acá — la RLS de team_members filtra.
 */
export async function assignExpertToSystem(
  systemId: string,
  teamMemberId: string | null,
): Promise<AcademiaSystemRow> {
  return updateSystem(systemId, { expert_team_member_id: teamMemberId });
}

export interface CohortForSystem {
  id: string;
  name: string;
  status: "planned" | "active" | "finished" | "cancelled";
  start_date: string | null;
  end_date: string | null;
  course_id: string | null;
}

export async function listCohortsBySystem(
  systemId: string,
): Promise<CohortForSystem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("cohorts")
    .select("id, name, status, start_date, end_date, course_id")
    .eq("system_id", systemId)
    .order("start_date", { ascending: false });
  return (data ?? []) as unknown as CohortForSystem[];
}
