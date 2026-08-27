import "server-only";

import { unstable_cache } from "next/cache";

import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Cache de datos de referencia de Academia scoped por organización.
 *
 * Estas tablas cambian poco (products, projects, courses, systems,
 * external_apps) y varias páginas del módulo las repiten. Cachearlas
 * evita el waterfall de queries en cada render.
 *
 * Reglas:
 *   - unstable_cache no puede leer cookies() — por eso resolvemos org_id
 *     fuera y usamos service-role adentro con filtro explícito.
 *   - Cada tag incluye orgId para no cruzar tenants.
 *   - Los actions que mutan estas tablas llaman updateTag/revalidateTag con
 *     las mismas keys que se generan acá.
 *
 * Los `as any` sobre el client son deliberados: los types generados de
 * postgrest están viejos (no incluyen organization_id/ownership ni las
 * tablas academia_*). Es el mismo patrón que el resto del codebase.
 */

export interface ProjectRef {
  readonly id: string;
  readonly name: string;
  readonly ownership: string;
}

export interface ProductRef {
  readonly id: string;
  readonly name: string;
  readonly project_id: string;
}

export interface CourseRef {
  readonly id: string;
  readonly product_id: string;
  readonly project_id: string;
  readonly active: boolean;
  readonly has_systems: boolean;
  readonly duration_hours: number | null;
  readonly modules_count: number | null;
  readonly default_access_days: number | null;
  readonly ghl_expiration_webhook_url: string | null;
  readonly external_app_id: string | null;
  readonly progress_source: string;
}

export interface SystemRef {
  readonly id: string;
  readonly course_id: string;
  readonly name: string;
  readonly active: boolean;
}

export interface ExternalAppRef {
  readonly id: string;
  readonly name: string;
  readonly project_id: string;
  readonly active: boolean;
}

// ─── Tags ──────────────────────────────────────────────────────────────

export function tagProjects(orgId: string): string {
  return `academia:${orgId}:projects`;
}
export function tagProducts(orgId: string): string {
  return `academia:${orgId}:products`;
}
export function tagCourses(orgId: string): string {
  return `academia:${orgId}:courses`;
}
export function tagSystems(orgId: string): string {
  return `academia:${orgId}:systems`;
}
export function tagExternalApps(orgId: string): string {
  return `academia:${orgId}:external-apps`;
}

// Helper para actions — evita repetir la resolución de orgId en cada mutación.
export async function currentOrgTagsAcademia(): Promise<{
  readonly projects: string;
  readonly products: string;
  readonly courses: string;
  readonly systems: string;
  readonly externalApps: string;
} | null> {
  const orgId = await resolveCurrentOrganizationId();
  if (!orgId) return null;
  return {
    projects: tagProjects(orgId),
    products: tagProducts(orgId),
    courses: tagCourses(orgId),
    systems: tagSystems(orgId),
    externalApps: tagExternalApps(orgId),
  };
}

// ─── Loaders internos (cacheados) ──────────────────────────────────────

const REVALIDATE = 300; // 5 min — igual se actualiza por tag en mutación.

function loadPropiaProjects(orgId: string) {
  return unstable_cache(
    async (): Promise<ProjectRef[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = createServiceClient() as any;
      const { data, error } = await svc
        .from("projects")
        .select("id, name, ownership")
        .eq("organization_id", orgId)
        .eq("ownership", "propia")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ProjectRef[];
    },
    ["academia", "projects", "propia", orgId],
    { tags: [tagProjects(orgId)], revalidate: REVALIDATE },
  )();
}

function loadAllProducts(orgId: string) {
  return unstable_cache(
    async (): Promise<ProductRef[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = createServiceClient() as any;
      const { data, error } = await svc
        .from("products")
        .select("id, name, project_id, projects!inner(organization_id)")
        .eq("projects.organization_id", orgId)
        .order("name", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as Array<
        ProductRef & { projects: unknown }
      >).map(({ id, name, project_id }) => ({ id, name, project_id }));
    },
    ["academia", "products", orgId],
    { tags: [tagProducts(orgId)], revalidate: REVALIDATE },
  )();
}

function loadCourses(orgId: string, activeOnly: boolean) {
  return unstable_cache(
    async (): Promise<CourseRef[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = createServiceClient() as any;
      let q = svc
        .from("courses")
        .select(
          "id, product_id, project_id, active, has_systems, duration_hours, modules_count, default_access_days, ghl_expiration_webhook_url, external_app_id, progress_source, projects!inner(organization_id)",
        )
        .eq("projects.organization_id", orgId);
      if (activeOnly) q = q.eq("active", true);
      const { data, error } = await q.order("active", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as Array<CourseRef & { projects: unknown }>).map(
        (r) => ({
          id: r.id,
          product_id: r.product_id,
          project_id: r.project_id,
          active: r.active,
          has_systems: r.has_systems,
          duration_hours: r.duration_hours,
          modules_count: r.modules_count,
          default_access_days: r.default_access_days,
          ghl_expiration_webhook_url: r.ghl_expiration_webhook_url,
          external_app_id: r.external_app_id,
          progress_source: r.progress_source,
        }),
      );
    },
    ["academia", "courses", activeOnly ? "active" : "all", orgId],
    { tags: [tagCourses(orgId)], revalidate: REVALIDATE },
  )();
}

function loadActiveSystems(orgId: string) {
  return unstable_cache(
    async (): Promise<SystemRef[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = createServiceClient() as any;
      const { data, error } = await svc
        .from("academia_systems")
        .select(
          "id, course_id, name, active, courses!inner(project_id, projects!inner(organization_id))",
        )
        .eq("active", true)
        .eq("courses.projects.organization_id", orgId);
      if (error) throw error;
      return ((data ?? []) as Array<SystemRef & { courses: unknown }>).map(
        ({ id, course_id, name, active }) => ({
          id,
          course_id,
          name,
          active,
        }),
      );
    },
    ["academia", "systems", "active", orgId],
    { tags: [tagSystems(orgId)], revalidate: REVALIDATE },
  )();
}

function loadExternalApps(orgId: string) {
  return unstable_cache(
    async (): Promise<ExternalAppRef[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = createServiceClient() as any;
      const { data, error } = await svc
        .from("external_apps")
        .select(
          "id, name, project_id, active, projects!inner(organization_id)",
        )
        .eq("projects.organization_id", orgId)
        .order("name", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as Array<
        ExternalAppRef & { projects: unknown }
      >).map(({ id, name, project_id, active }) => ({
        id,
        name,
        project_id,
        active,
      }));
    },
    ["academia", "external-apps", orgId],
    { tags: [tagExternalApps(orgId)], revalidate: REVALIDATE },
  )();
}

// ─── API pública ──────────────────────────────────────────────────────

async function orgIdOrThrow(): Promise<string> {
  const id = await resolveCurrentOrganizationId();
  if (!id) throw new Error("No hay organización visible para este usuario.");
  return id;
}

export async function getPropiaProjects(): Promise<ProjectRef[]> {
  const orgId = await orgIdOrThrow();
  return loadPropiaProjects(orgId);
}

export async function getAllProducts(): Promise<ProductRef[]> {
  const orgId = await orgIdOrThrow();
  return loadAllProducts(orgId);
}

export async function getActiveCourses(): Promise<CourseRef[]> {
  const orgId = await orgIdOrThrow();
  return loadCourses(orgId, true);
}

export async function getAllCourses(): Promise<CourseRef[]> {
  const orgId = await orgIdOrThrow();
  return loadCourses(orgId, false);
}

export async function getActiveSystems(): Promise<SystemRef[]> {
  const orgId = await orgIdOrThrow();
  return loadActiveSystems(orgId);
}

export async function getAllExternalApps(): Promise<ExternalAppRef[]> {
  const orgId = await orgIdOrThrow();
  return loadExternalApps(orgId);
}
