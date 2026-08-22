import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createServiceClient } from "@/lib/supabase/service";

// El Database type generado no incluye las tablas de academia (0071-0149).
// Casteamos a `AnySupabase` para trabajar contra las nuevas tablas sin
// perder autocompletion en el resto del código (mismo patrón que
// src/lib/notion/sync-runner.ts).
type AnySupabase = SupabaseClient<any, any, any>;

function loose(client: ReturnType<typeof createServiceClient>): AnySupabase {
  return client as unknown as AnySupabase;
}

/**
 * Lifecycle de expiración de enrollments (Fase D del plan Academia).
 *
 * Este módulo se usa desde:
 *   1) El cron diario `/api/cron/academia-daily` — barre todos los enrollments
 *      con `access_expires_at < today` y `status = 'active'`, los marca
 *      'expired' y dispara el webhook de GHL configurado en el curso.
 *   2) Un server action en la ficha del alumno — botón "Dar de baja ahora"
 *      fuerza la expiración manual de un enrollment antes de la fecha.
 *
 * Toda la escritura pasa por service_role (bypass RLS): los eventos son
 * de sistema y la tabla `enrollment_expiration_events` es read-only para
 * authenticated (0149).
 */

// ═══════════════════════════════════════════════════════════════════════════
// Tipos locales — los generados no incluyen las tablas nuevas todavía.
// ═══════════════════════════════════════════════════════════════════════════

export type WebhookStatus = "pending" | "sent" | "failed" | "skipped";

export interface ExpirationEventRow {
  readonly id: string;
  readonly enrollment_id: string;
  readonly course_id: string;
  readonly project_id: string;
  readonly triggered_at: string;
  readonly webhook_url: string | null;
  readonly webhook_status: WebhookStatus;
  readonly webhook_response: string | null;
  readonly retries: number;
  readonly last_attempt_at: string | null;
}

export interface WebhookPayload {
  readonly studentEmail: string | null;
  readonly studentName: string | null;
  readonly courseId: string;
  readonly courseName: string | null;
  readonly enrollmentId: string;
  readonly expiredAt: string;
}

interface EnrollmentContext {
  readonly enrollmentId: string;
  readonly cohortId: string;
  readonly studentId: string;
  readonly accessExpiresAt: string | null;
  readonly courseId: string;
  readonly courseName: string | null;
  readonly ghlExpirationWebhookUrl: string | null;
  readonly studentEmail: string | null;
  readonly studentName: string | null;
}

const MAX_RETRIES = 3;
const RESPONSE_SNIPPET_MAX = 500;

// ═══════════════════════════════════════════════════════════════════════════
// expireEnrollment
// ═══════════════════════════════════════════════════════════════════════════

export interface ExpireEnrollmentOptions {
  /** Client service_role a reutilizar (evita crear uno nuevo por llamada). */
  readonly serviceClient?: ReturnType<typeof createServiceClient>;
  /**
   * Si true, marca 'expired' incluso si el enrollment no estaba 'active'.
   * Usar solo desde el botón manual, no desde el cron.
   */
  readonly force?: boolean;
}

/**
 * Expira 1 enrollment y dispara el webhook a GHL si el curso lo tiene
 * configurado. Reutilizable desde el cron y desde el botón manual de UI.
 *
 * Idempotencia: si el enrollment ya está 'expired', devuelve null sin
 * hacer nada (salvo que force=true). El caller debería tratarlo como éxito.
 */
export async function expireEnrollment(
  enrollmentId: string,
  opts: ExpireEnrollmentOptions = {},
): Promise<ExpirationEventRow | null> {
  const rawClient = opts.serviceClient ?? createServiceClient();
  const client = loose(rawClient);

  const context = await loadEnrollmentContext(client, enrollmentId);
  if (!context) {
    throw new Error(`enrollment ${enrollmentId} no existe`);
  }

  // Chequeo actual de status para evitar re-marcar. El caller manual puede
  // forzar (usualmente no tiene sentido — si ya está 'expired' no hay nada
  // que hacer).
  const currentStatusRes = await client
    .from("enrollments")
    .select("status")
    .eq("id", enrollmentId)
    .maybeSingle();

  const currentStatus =
    (currentStatusRes.data as { status: string } | null)?.status ?? null;
  if (currentStatus === "expired" && !opts.force) {
    return null;
  }

  // Paso 1: marcar 'expired' en enrollments.
  const { error: updErr } = await client
    .from("enrollments")
    .update({ status: "expired" })
    .eq("id", enrollmentId);
  if (updErr) {
    throw new Error(
      `no pude marcar enrollment ${enrollmentId} como expired: ${updErr.message}`,
    );
  }

  // Paso 2: crear el event log en estado 'pending' (o 'skipped' si no hay URL).
  const webhookUrl = context.ghlExpirationWebhookUrl;
  const eventPayload = {
    enrollment_id: enrollmentId,
    // course_id + project_id los denormaliza el trigger 0149 — pasamos
    // placeholder que el trigger sobreescribe.
    course_id: context.courseId,
    project_id: context.courseId,
    webhook_url: webhookUrl,
    webhook_status: webhookUrl ? "pending" : "skipped",
  };

  const { data: insertedRaw, error: insErr } = await client
    .from("enrollment_expiration_events")
    .insert(eventPayload)
    .select("*")
    .single();

  if (insErr) {
    throw new Error(
      `no pude crear el expiration event: ${insErr.message}`,
    );
  }
  let event = insertedRaw as ExpirationEventRow;

  // Paso 3: si hay URL, intentar el webhook.
  if (webhookUrl) {
    const payload: WebhookPayload = {
      studentEmail: context.studentEmail,
      studentName: context.studentName,
      courseId: context.courseId,
      courseName: context.courseName,
      enrollmentId,
      expiredAt: context.accessExpiresAt ?? new Date().toISOString(),
    };
    event = await attemptWebhook(client, event, webhookUrl, payload);
  }

  return event;
}

// ═══════════════════════════════════════════════════════════════════════════
// runDailyExpirations — barrido de enrollments vencidos
// ═══════════════════════════════════════════════════════════════════════════

export interface DailyExpirationsSummary {
  readonly considered: number;
  readonly expired: number;
  readonly webhookSent: number;
  readonly webhookFailed: number;
  readonly webhookSkipped: number;
  readonly errors: readonly string[];
}

/**
 * Corrida diaria de expiraciones. Trae todos los enrollments vencidos
 * activos, los marca expired y dispara webhook (con reintentos en caso
 * de fallo dentro de la misma corrida — el retry de eventos previos
 * failed se hace en `retryPendingWebhooks`).
 */
export async function runDailyExpirations(
  serviceClient?: ReturnType<typeof createServiceClient>,
): Promise<DailyExpirationsSummary> {
  const rawClient = serviceClient ?? createServiceClient();
  const client = loose(rawClient);

  const today = new Date().toISOString().slice(0, 10);

  const { data: rows, error } = await client
    .from("enrollments")
    .select("id")
    .eq("status", "active")
    .not("access_expires_at", "is", null)
    .lt("access_expires_at", today);

  if (error) {
    return {
      considered: 0,
      expired: 0,
      webhookSent: 0,
      webhookFailed: 0,
      webhookSkipped: 0,
      errors: [`query enrollments vencidos: ${error.message}`],
    };
  }

  const enrollmentIds = ((rows ?? []) as { id: string }[]).map((r) => r.id);
  const summary = {
    considered: enrollmentIds.length,
    expired: 0,
    webhookSent: 0,
    webhookFailed: 0,
    webhookSkipped: 0,
    errors: [] as string[],
  };

  for (const id of enrollmentIds) {
    try {
      const event = await expireEnrollment(id, { serviceClient: rawClient });
      if (!event) continue; // ya estaba expired
      summary.expired += 1;
      if (event.webhook_status === "sent") summary.webhookSent += 1;
      else if (event.webhook_status === "failed") summary.webhookFailed += 1;
      else if (event.webhook_status === "skipped") summary.webhookSkipped += 1;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "expireEnrollment threw non-Error";
      summary.errors.push(`enrollment ${id}: ${message}`);
    }
  }

  return summary;
}

// ═══════════════════════════════════════════════════════════════════════════
// retryPendingWebhooks — reintenta events 'failed' con retries<3
// ═══════════════════════════════════════════════════════════════════════════

export interface RetryPendingSummary {
  readonly retried: number;
  readonly sent: number;
  readonly failed: number;
}

export async function retryPendingWebhooks(
  serviceClient?: ReturnType<typeof createServiceClient>,
): Promise<RetryPendingSummary> {
  const rawClient = serviceClient ?? createServiceClient();
  const client = loose(rawClient);

  const { data: rows, error } = await client
    .from("enrollment_expiration_events")
    .select("*")
    .eq("webhook_status", "failed")
    .lt("retries", MAX_RETRIES)
    .order("last_attempt_at", { ascending: true, nullsFirst: true })
    .limit(200);

  if (error) {
    return { retried: 0, sent: 0, failed: 0 };
  }

  const events = (rows ?? []) as unknown as ExpirationEventRow[];
  const summary = { retried: 0, sent: 0, failed: 0 };

  for (const event of events) {
    if (!event.webhook_url) continue;

    const context = await loadEnrollmentContext(client, event.enrollment_id);
    if (!context) continue;

    const payload: WebhookPayload = {
      studentEmail: context.studentEmail,
      studentName: context.studentName,
      courseId: context.courseId,
      courseName: context.courseName,
      enrollmentId: event.enrollment_id,
      expiredAt: context.accessExpiresAt ?? event.triggered_at,
    };
    const updated = await attemptWebhook(client, event, event.webhook_url, payload);
    summary.retried += 1;
    if (updated.webhook_status === "sent") summary.sent += 1;
    else if (updated.webhook_status === "failed") summary.failed += 1;
  }

  return summary;
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers internos
// ═══════════════════════════════════════════════════════════════════════════

async function loadEnrollmentContext(
  client: AnySupabase,
  enrollmentId: string,
): Promise<EnrollmentContext | null> {
  const enrRes = await client
    .from("enrollments")
    .select("id, cohort_id, student_id, access_expires_at")
    .eq("id", enrollmentId)
    .maybeSingle();
  const enrollment = enrRes.data as {
    id: string;
    cohort_id: string;
    student_id: string;
    access_expires_at: string | null;
  } | null;
  if (!enrollment) return null;

  const cohortRes = await client
    .from("cohorts")
    .select("id, course_id")
    .eq("id", enrollment.cohort_id)
    .maybeSingle();
  const cohort = cohortRes.data as { id: string; course_id: string | null } | null;
  if (!cohort || !cohort.course_id) return null;

  const [courseRes, studentRes] = await Promise.all([
    client
      .from("courses")
      .select("id, product_id, ghl_expiration_webhook_url")
      .eq("id", cohort.course_id)
      .maybeSingle(),
    client
      .from("students")
      .select("id, name, email")
      .eq("id", enrollment.student_id)
      .maybeSingle(),
  ]);
  const course = courseRes.data as {
    id: string;
    product_id: string;
    ghl_expiration_webhook_url: string | null;
  } | null;
  if (!course) return null;

  // Nombre del curso vive en products (courses cuelga de products).
  const prodRes = await client
    .from("products")
    .select("name")
    .eq("id", course.product_id)
    .maybeSingle();
  const courseName: string | null =
    (prodRes.data as { name: string } | null)?.name ?? null;

  const student = studentRes.data as {
    id: string;
    name: string | null;
    email: string | null;
  } | null;

  return {
    enrollmentId: enrollment.id,
    cohortId: enrollment.cohort_id,
    studentId: enrollment.student_id,
    accessExpiresAt: enrollment.access_expires_at,
    courseId: course.id,
    courseName,
    ghlExpirationWebhookUrl: course.ghl_expiration_webhook_url,
    studentEmail: student?.email ?? null,
    studentName: student?.name ?? null,
  };
}

async function attemptWebhook(
  client: AnySupabase,
  event: ExpirationEventRow,
  url: string,
  payload: WebhookPayload,
): Promise<ExpirationEventRow> {
  let status: WebhookStatus = "failed";
  let snippet: string | null = null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const text = await res.text().catch(() => "");
    snippet = truncateResponse(text);
    status = res.ok ? "sent" : "failed";
    if (!res.ok) {
      snippet = `HTTP ${res.status} — ${snippet ?? ""}`.slice(
        0,
        RESPONSE_SNIPPET_MAX,
      );
    }
  } catch (err) {
    status = "failed";
    snippet = truncateResponse(
      err instanceof Error ? err.message : "webhook threw non-Error",
    );
  }

  const updatePayload = {
    webhook_status: status,
    webhook_response: snippet,
    last_attempt_at: new Date().toISOString(),
    retries: event.retries + 1,
  };

  const { data: updated, error: updErr } = await client
    .from("enrollment_expiration_events")
    .update(updatePayload)
    .eq("id", event.id)
    .select("*")
    .single();

  if (updErr) {
    // No re-lanzamos — el error de update de un event no debe romper el
    // barrido entero. Devolvemos el snapshot local con la mejor estimación.
    return {
      ...event,
      webhook_status: status,
      webhook_response: snippet,
      last_attempt_at: new Date().toISOString(),
      retries: event.retries + 1,
    };
  }
  return updated as ExpirationEventRow;
}

function truncateResponse(text: string | null): string | null {
  if (text == null) return null;
  const clean = text.trim();
  if (clean.length === 0) return null;
  if (clean.length <= RESPONSE_SNIPPET_MAX) return clean;
  return clean.slice(0, RESPONSE_SNIPPET_MAX);
}
