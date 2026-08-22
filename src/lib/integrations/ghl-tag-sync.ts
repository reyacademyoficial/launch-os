import "server-only";

import { createServiceClient } from "@/lib/supabase/service";

import { GHL_API_BASE, GHL_API_VERSION } from "./ghl";

/**
 * Sync PULL de tags GHL → progreso de módulos (Fase C, plan Academia).
 *
 * Approach: en vez de webhook inbound, el cron diario recorre los cursos con
 * `progress_source='ghl_tags'` y por cada tag mapeada dispara
 * `POST /contacts/search` con filtro `tags contains <tag>`. GHL devuelve los
 * contactos con esa tag; los matcheamos por email contra `students.email` del
 * proyecto (case-insensitive). Si hay match y existe enrollment activo al
 * curso, upserteamos `student_module_progress` con `completed_at=now()`,
 * `source='ghl_tag'`, `source_ref=<tag>`.
 *
 * Idempotencia: unique(enrollment_id, course_module_id) + upsert onConflict →
 * volver a correr el sync no duplica progresos ni pisa completed_at que ya
 * hayamos seteado (solo el updated_at avanza).
 *
 * Credenciales: reusamos el PIT que ya cargó cualquier launch del proyecto
 * (`launch_secrets.provider='ghl'`). El location_id vive en
 * `projects.ghl_location_id` (agregado en 0142). Si falta alguno, el sync
 * corta con contadores en cero — no rompe.
 *
 * NO se llama solo. El endpoint del cron (Fase D — /api/cron/academia-daily)
 * invoca `syncAllGhlTrackedCourses(service)` después de las expiraciones. La
 * UI de curso expone un botón manual que llama `syncTagProgressForCourse`.
 */

export interface TagSyncResult {
  /** Cuántas tags únicas se consultaron a GHL. */
  tagsChecked: number;
  /** Cuántos contactos (dedup por email) devolvió GHL en total. */
  contactsMatched: number;
  /** Cuántos progresos se upsertearon (matches con enrollment activo). */
  progressUpserted: number;
  /**
   * Motivo por el que no se procesó nada (missing_token, missing_location, etc.).
   * Solo presente cuando el sync se salteó a nivel curso.
   */
  skippedReason?:
    | "missing_location_id"
    | "missing_token"
    | "no_mappings"
    | "no_students"
    | "no_active_enrollments"
    | "course_not_found";
}

interface TagMappingRow {
  id: string;
  course_module_id: string;
  ghl_tag: string;
}

interface CourseMetaRow {
  id: string;
  project_id: string;
  progress_source: string;
}

interface EnrollmentActiveRow {
  id: string;
  student_id: string;
}

interface StudentEmailRow {
  id: string;
  email: string | null;
}

interface GhlContactSearchHit {
  id: string;
  email: string | null;
}

/**
 * Cliente Supabase lo suficientemente laxo para testear con mocks. Aceptamos
 * cualquier objeto con `.from(name)` — cubre tanto el ServiceClient real como
 * un stub de vitest.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SupabaseLike = { from: (name: string) => any };

const CONTACTS_SEARCH_URL = `${GHL_API_BASE}/contacts/search`;
const PAGE_LIMIT = 100;
// Techo defensivo — locations típicas tienen <10k contactos con una tag
// específica; si algún día llegamos a 100k por tag, la mecánica de pull
// diario se vuelve inviable y hay que rediseñar (webhooks / cursor persistido).
const MAX_PAGES_PER_TAG = 100;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Sincroniza el progreso via tags GHL para UN curso. Se invoca:
 *   - desde el botón "Sincronizar ahora" en la UI de módulos
 *   - desde el cron (via `syncAllGhlTrackedCourses`)
 *
 * No valida rol acá — el caller (server action UI o cron con service role)
 * es responsable de gatearlo antes de invocar.
 *
 * `client` es opcional para permitir inyección de mocks en tests; si no se
 * pasa, se crea un service client real (bypassea RLS).
 */
export async function syncTagProgressForCourse(
  courseId: string,
  client?: SupabaseLike,
): Promise<TagSyncResult> {
  const loose = (client ?? createServiceClient()) as SupabaseLike;

  // 1) Cargar el curso + su proyecto + location_id.
  const courseRes = await loose
    .from("courses")
    .select("id, project_id, progress_source")
    .eq("id", courseId)
    .maybeSingle();
  const course = (courseRes.data ?? null) as CourseMetaRow | null;
  if (!course) {
    return {
      tagsChecked: 0,
      contactsMatched: 0,
      progressUpserted: 0,
      skippedReason: "course_not_found",
    };
  }

  const projectRes = await loose
    .from("projects")
    .select("id, ghl_location_id")
    .eq("id", course.project_id)
    .maybeSingle();
  const projectRow =
    (projectRes.data ?? null) as { id: string; ghl_location_id: string | null } | null;
  const locationId = projectRow?.ghl_location_id ?? null;
  if (!locationId) {
    return {
      tagsChecked: 0,
      contactsMatched: 0,
      progressUpserted: 0,
      skippedReason: "missing_location_id",
    };
  }

  // 2) Token GHL: reusamos el PIT que cargó cualquier launch del proyecto
  //    (todos apuntan a la misma location). Preferimos el más reciente para
  //    minimizar chances de agarrar uno revocado.
  const token = await resolveGhlToken(loose, course.project_id);
  if (!token) {
    return {
      tagsChecked: 0,
      contactsMatched: 0,
      progressUpserted: 0,
      skippedReason: "missing_token",
    };
  }

  // 3) Traer mappings del curso: module_ghl_tag_mappings JOIN course_modules
  //    donde course_id = courseId. Sin PostgREST embed avanzado, hacemos dos
  //    queries: (a) módulos del curso, (b) mappings de esos módulos.
  const modulesRes = await loose
    .from("course_modules")
    .select("id")
    .eq("course_id", courseId);
  const moduleIds = ((modulesRes.data ?? []) as { id: string }[]).map(
    (m) => m.id,
  );
  if (moduleIds.length === 0) {
    return {
      tagsChecked: 0,
      contactsMatched: 0,
      progressUpserted: 0,
      skippedReason: "no_mappings",
    };
  }

  const mappingsRes = await loose
    .from("module_ghl_tag_mappings")
    .select("id, course_module_id, ghl_tag")
    .in("course_module_id", moduleIds);
  const mappings = ((mappingsRes.data ?? []) as TagMappingRow[]).filter(
    (m) => m.ghl_tag && m.ghl_tag.trim().length > 0,
  );
  if (mappings.length === 0) {
    return {
      tagsChecked: 0,
      contactsMatched: 0,
      progressUpserted: 0,
      skippedReason: "no_mappings",
    };
  }

  // 4) Preload de students del proyecto (email → studentId, lower-case).
  const studentsRes = await loose
    .from("students")
    .select("id, email")
    .eq("project_id", course.project_id);
  const studentEmailToId = new Map<string, string>();
  for (const s of (studentsRes.data ?? []) as StudentEmailRow[]) {
    if (!s.email) continue;
    const key = s.email.trim().toLowerCase();
    if (key.length === 0) continue;
    // Un email puede tener múltiples students por race, pero el unique
    // parcial (project_id, lower(email)) del schema 0071 lo evita — nos
    // quedamos con el último que veamos.
    studentEmailToId.set(key, s.id);
  }
  if (studentEmailToId.size === 0) {
    return {
      tagsChecked: mappings.length,
      contactsMatched: 0,
      progressUpserted: 0,
      skippedReason: "no_students",
    };
  }

  // 5) Preload de enrollments activos del curso: cohorts del curso → sus
  //    enrollments con status='active'. Estructuramos como Map<studentId,
  //    enrollmentId> — un student con múltiples enrollments activos al
  //    mismo curso no debería ocurrir, pero si ocurre nos quedamos con uno
  //    (la unique(student_id, cohort_id) evita duplicar dentro de la misma
  //    cohort; entre cohorts es raro).
  const cohortsRes = await loose
    .from("cohorts")
    .select("id")
    .eq("course_id", courseId);
  const cohortIds = ((cohortsRes.data ?? []) as { id: string }[]).map(
    (c) => c.id,
  );

  const enrollmentByStudent = new Map<string, string>();
  if (cohortIds.length > 0) {
    const enrollmentsRes = await loose
      .from("enrollments")
      .select("id, student_id")
      .in("cohort_id", cohortIds)
      .eq("status", "active");
    for (const e of (enrollmentsRes.data ?? []) as EnrollmentActiveRow[]) {
      enrollmentByStudent.set(e.student_id, e.id);
    }
  }
  if (enrollmentByStudent.size === 0) {
    return {
      tagsChecked: mappings.length,
      contactsMatched: 0,
      progressUpserted: 0,
      skippedReason: "no_active_enrollments",
    };
  }

  // 6) Por cada mapping: llamar a /contacts/search filtrando por la tag.
  //    Paginamos hasta agotar. Por cada contact con email matcheable →
  //    upsert student_module_progress.
  let contactsMatched = 0;
  let progressUpserted = 0;
  const upsertedKeys = new Set<string>(); // dedupe (enrollment, module) por corrida

  for (const mapping of mappings) {
    const tag = mapping.ghl_tag.trim();
    const hits = await fetchContactsByTag({
      token,
      locationId,
      tag,
    });

    for (const contact of hits) {
      if (!contact.email) continue;
      const emailKey = contact.email.trim().toLowerCase();
      if (emailKey.length === 0) continue;

      const studentId = studentEmailToId.get(emailKey);
      if (!studentId) continue; // el contacto no es alumno del proyecto

      const enrollmentId = enrollmentByStudent.get(studentId);
      if (!enrollmentId) continue; // sin enrollment activo al curso

      contactsMatched++;

      const dedupeKey = `${enrollmentId}::${mapping.course_module_id}`;
      if (upsertedKeys.has(dedupeKey)) continue;
      upsertedKeys.add(dedupeKey);

      // Upsert: si ya existe la fila, solo refresca `updated_at`. Si es
      // nueva, arranca con `completed_at=now()` porque la presencia de la
      // tag en GHL es la señal de completado.
      const payload = {
        enrollment_id: enrollmentId,
        course_module_id: mapping.course_module_id,
        // project_id es NOT NULL y el trigger lo autofilla desde enrollment.
        // Enviamos placeholder — el trigger lo sobreescribe.
        project_id: mapping.course_module_id,
        completed_at: new Date().toISOString(),
        source: "ghl_tag",
        source_ref: tag,
      } as unknown as never;

      const upsertRes = await loose
        .from("student_module_progress")
        .upsert(payload, {
          onConflict: "enrollment_id,course_module_id",
          ignoreDuplicates: false,
        });

      if (!upsertRes.error) {
        progressUpserted++;
      }
    }
  }

  return {
    tagsChecked: mappings.length,
    contactsMatched,
    progressUpserted,
  };
}

/**
 * Itera todos los cursos con `progress_source='ghl_tags'` y sincroniza cada
 * uno. Retorna resultados individuales para logging del cron.
 *
 * Usado por el cron diario `/api/cron/academia-daily` (Fase D — Lifecycle).
 * El caller debe pasar el service client (bypassea RLS) para acceder a los
 * cursos de todos los proyectos.
 */
export async function syncAllGhlTrackedCourses(
  client?: SupabaseLike,
): Promise<Array<{ courseId: string; result: TagSyncResult }>> {
  const loose = (client ?? createServiceClient()) as SupabaseLike;

  const coursesRes = await loose
    .from("courses")
    .select("id")
    .eq("progress_source", "ghl_tags");

  const courseIds = ((coursesRes.data ?? []) as { id: string }[]).map(
    (c) => c.id,
  );

  const out: Array<{ courseId: string; result: TagSyncResult }> = [];
  for (const courseId of courseIds) {
    const result = await syncTagProgressForCourse(courseId, loose);
    out.push({ courseId, result });
  }
  return out;
}

// ─── Internals ───────────────────────────────────────────────────────────────

interface FetchContactsByTagArgs {
  token: string;
  locationId: string;
  tag: string;
}

/**
 * Pagina `POST /contacts/search` filtrando por `tags contains <tag>`.
 * Deduplica por contact.id entre páginas. Corta al primer 4xx/5xx (no vale
 * la pena reintentar acá — el próximo sync diario lo re-intenta).
 *
 * Exportada solo para tests.
 */
export async function fetchContactsByTag(
  args: FetchContactsByTagArgs,
): Promise<GhlContactSearchHit[]> {
  const seen = new Set<string>();
  const out: GhlContactSearchHit[] = [];

  // Paginación por cursor a la manera de GHL — `searchAfter` es un array
  // devuelto en la respuesta para continuar. Cuando la página trae menos que
  // PAGE_LIMIT o searchAfter es null, se termina.
  let searchAfter: unknown[] | null = null;

  for (let page = 0; page < MAX_PAGES_PER_TAG; page++) {
    const body: Record<string, unknown> = {
      locationId: args.locationId,
      pageLimit: PAGE_LIMIT,
      filters: [
        {
          field: "tags",
          operator: "contains",
          value: args.tag,
        },
      ],
    };
    if (searchAfter) {
      body.searchAfter = searchAfter;
    }

    let res: Response;
    try {
      res = await fetch(CONTACTS_SEARCH_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${args.token}`,
          Version: GHL_API_VERSION,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        cache: "no-store",
      });
    } catch {
      break; // red caída — corte silencioso, retomamos en próximo sync
    }

    if (!res.ok) break;

    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      break;
    }

    const contacts = extractContactsArray(payload);
    if (contacts.length === 0) break;

    let addedThisPage = 0;
    let lastContact: Record<string, unknown> | null = null;
    for (const raw of contacts) {
      if (typeof raw !== "object" || raw === null) continue;
      const c = raw as Record<string, unknown>;
      lastContact = c;
      const id = typeof c.id === "string" ? c.id : null;
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      const email = typeof c.email === "string" ? c.email : null;
      out.push({ id, email });
      addedThisPage++;
    }

    // Cortes de paginación:
    //   1) menos items que el pageLimit → última página parcial.
    //   2) sin nada nuevo (todo era duplicado) → siguiente no aporta.
    if (contacts.length < PAGE_LIMIT) break;
    if (addedThisPage === 0) break;

    // Buscamos cursor `searchAfter` de dos ubicaciones posibles (GHL a veces
    // lo pone en meta.searchAfter, otras a nivel top-level).
    const nextCursor = extractSearchAfter(payload, lastContact);
    if (!nextCursor) break;
    searchAfter = nextCursor;
  }

  return out;
}

function extractContactsArray(payload: unknown): unknown[] {
  if (typeof payload !== "object" || payload === null) return [];
  const obj = payload as Record<string, unknown>;
  if (Array.isArray(obj.contacts)) return obj.contacts;
  if (Array.isArray(obj.data)) return obj.data;
  return [];
}

function extractSearchAfter(
  payload: unknown,
  lastContact: Record<string, unknown> | null,
): unknown[] | null {
  if (typeof payload === "object" && payload !== null) {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.searchAfter)) return obj.searchAfter;
    const meta = obj.meta;
    if (typeof meta === "object" && meta !== null) {
      const m = meta as Record<string, unknown>;
      if (Array.isArray(m.searchAfter)) return m.searchAfter;
    }
  }
  // Fallback: usar `searchAfter` del último contacto si viene expuesto.
  if (lastContact && Array.isArray(lastContact.searchAfter)) {
    return lastContact.searchAfter as unknown[];
  }
  return null;
}

/**
 * Busca el PIT de GHL a nivel proyecto. Estrategia: buscar el launch_secret
 * `provider='ghl'` más reciente de cualquier launch del proyecto — todos
 * apuntan a la misma location del cliente, así que sirve cualquiera.
 *
 * Retorna null si el proyecto no tiene ningún launch con GHL conectado.
 */
async function resolveGhlToken(
  loose: SupabaseLike,
  projectId: string,
): Promise<string | null> {
  const launchesRes = await loose
    .from("launches")
    .select("id")
    .eq("project_id", projectId);
  const launchIds = ((launchesRes.data ?? []) as { id: string }[]).map(
    (l) => l.id,
  );
  if (launchIds.length === 0) return null;

  const secretsRes = await loose
    .from("launch_secrets")
    .select("secret, updated_at")
    .in("launch_id", launchIds)
    .eq("provider", "ghl")
    .order("updated_at", { ascending: false })
    .limit(1);

  const first = (secretsRes.data ?? [])[0] as
    | { secret: string; updated_at: string }
    | undefined;
  return first?.secret ?? null;
}
