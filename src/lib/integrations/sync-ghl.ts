import "server-only";

import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

import {
  fetchGhlAppointments,
  fetchGhlConversations,
  type GhlAppointment,
  type GhlConversation,
  type GhlFetchResult,
} from "./ghl";
import {
  resolveMatchAction,
  type EventKind,
  type ExistingLeadView,
  type MatchAction,
} from "./ghl-match";

import type { createServiceClient } from "@/lib/supabase/service";
import type { LeadStatus } from "@/lib/leads/types";

/**
 * Lógica de match + persistencia para el sync de GHL. Recibe el service-role
 * client, llama al adapter, normaliza teléfonos, busca leads por
 * `phone_normalized` o por `external_id`, y aplica los INSERT/UPDATE que
 * indica `resolveMatchAction`.
 *
 * Diseño:
 *   - 2 sub-fetches (appointments + conversations) → un solo `integration_run`.
 *   - Si appointments falla con `token_invalid` o `rate_limited`, lo
 *     propagamos sin procesar conversations (el orchestrator finaliza el run
 *     con ese kind). Si conversations falla después de un appointments OK,
 *     reportamos como `error` parcial — el run queda como `error` con detalle
 *     de qué se procesó.
 *   - El match se hace por (external_id, source) ANTES de por phone, para
 *     que la segunda corrida del sync no genere updates redundantes.
 */

type ServiceClient = ReturnType<typeof createServiceClient>;

export type GhlRunSummary =
  | {
      ok: true;
      appointments: { fetched: number; created: number; updated: number; skipped: number };
      conversations: { fetched: number; created: number; updated: number; skipped: number };
    }
  | {
      ok: false;
      kind: "token_invalid" | "rate_limited" | "error";
      message: string;
      detail: Record<string, unknown>;
      retryAfterSeconds?: number | null;
    };

export interface RunGhlSyncArgs {
  service: ServiceClient;
  token: string;
  locationId: string;
  defaultCountry: string;
  projectId: string;
  launchId: string;
  since: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD
}

export async function runGhlSync(args: RunGhlSyncArgs): Promise<GhlRunSummary> {
  const country = (args.defaultCountry || "AR") as CountryCode;

  const apptResult = await fetchGhlAppointments({
    token: args.token,
    locationId: args.locationId,
    since: args.since,
    until: args.until,
  });
  if (!apptResult.ok) return propagateFailure(apptResult);

  const apptSummary = await processBatch(
    args,
    "appointment",
    apptResult.rows,
    country,
    (e) => e.id,
    (e) => e.contactName,
    (e) => e.rawPhone,
    (e) => buildAppointmentNotes(e),
  );

  const convResult = await fetchGhlConversations({
    token: args.token,
    locationId: args.locationId,
    since: args.since,
    until: args.until,
  });
  if (!convResult.ok) return propagateFailure(convResult);

  const convSummary = await processBatch(
    args,
    "whatsapp",
    convResult.rows,
    country,
    (c) => c.id,
    (c) => c.contactName,
    (c) => c.rawPhone,
    (c) => buildConversationNotes(c),
  );

  return {
    ok: true,
    appointments: apptSummary,
    conversations: convSummary,
  };
}

// ─── processBatch ──────────────────────────────────────────────────────────

interface BatchSummary {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
}

async function processBatch<T>(
  args: RunGhlSyncArgs,
  eventKind: EventKind,
  rows: ReadonlyArray<T>,
  country: CountryCode,
  getId: (r: T) => string,
  getName: (r: T) => string,
  getPhone: (r: T) => string | null,
  getNotes: (r: T) => string | null,
): Promise<BatchSummary> {
  const summary: BatchSummary = {
    fetched: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
  };

  // Source que corresponde a este tipo de evento — lo usamos para el lookup
  // por external_id y para los inserts.
  const source: "ghl" | "whatsapp" =
    eventKind === "appointment" ? "ghl" : "whatsapp";

  for (const row of rows) {
    const externalId = getId(row);
    const rawPhone = getPhone(row);
    const phoneNormalized = normalize(rawPhone, country);

    // Paso 1: idempotencia por external_id. Si ya existe un lead vinculado
    // a este evento, aplicamos las reglas con esa fila.
    const byExternal = await findByExternalId(
      args.service,
      args.projectId,
      source,
      externalId,
    );

    // Paso 2: si no, intentamos por teléfono.
    let existing: ExistingLeadView | null = byExternal;
    if (!existing && phoneNormalized) {
      existing = await findByPhone(args.service, args.projectId, phoneNormalized);
    }

    const action = resolveMatchAction({
      eventKind,
      existing,
      externalId,
      contactName: getName(row),
      phoneNormalized,
      rawPhone,
    });

    const applied = await applyAction(args, action, getNotes(row));
    if (applied === "created") summary.created++;
    else if (applied === "updated") summary.updated++;
    else summary.skipped++;
  }
  return summary;
}

// ─── DB ops ────────────────────────────────────────────────────────────────

async function findByExternalId(
  service: ServiceClient,
  projectId: string,
  source: "ghl" | "whatsapp",
  externalId: string,
): Promise<ExistingLeadView | null> {
  const res = await service
    .from("leads")
    .select("id, status, pinned_to_kanban")
    .eq("project_id", projectId)
    .eq("source", source)
    .eq("external_id", externalId)
    .maybeSingle();
  if (!res.data) return null;
  const row = res.data as {
    id: string;
    status: LeadStatus;
    pinned_to_kanban: boolean;
  };
  return row;
}

async function findByPhone(
  service: ServiceClient,
  projectId: string,
  phoneNormalized: string,
): Promise<ExistingLeadView | null> {
  // No filtramos por source — un lead puede haber entrado por import/manual
  // y ahora vincularse a un appointment de GHL. Si hubiera ambigüedad
  // (varios leads con el mismo phone, lo que el unique partial ya evita),
  // tomamos el más reciente.
  const res = await service
    .from("leads")
    .select("id, status, pinned_to_kanban")
    .eq("project_id", projectId)
    .eq("phone_normalized", phoneNormalized)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!res.data) return null;
  const row = res.data as {
    id: string;
    status: LeadStatus;
    pinned_to_kanban: boolean;
  };
  return row;
}

async function applyAction(
  args: RunGhlSyncArgs,
  action: MatchAction,
  notes: string | null,
): Promise<"created" | "updated" | "skipped"> {
  if (action.kind === "noop") return "skipped";

  if (action.kind === "create") {
    const insertPayload = {
      ...action.payload,
      project_id: args.projectId,
      launch_id: args.launchId,
      // Notes solo en CREATE — no queremos pisar notas del operador en UPDATE.
      notes,
    } as never;
    const { error } = await args.service.from("leads").insert(insertPayload);
    if (error) {
      // Si el insert falla por colisión del unique partial (carrera con otro
      // proceso, o evento procesado en paralelo), lo contamos como skipped.
      if (isUniqueViolation(error.code)) return "skipped";
      // Cualquier otro error es real — re-throw para que el orchestrator lo
      // capture en el run.
      throw new Error(`GHL insert lead: ${error.message}`);
    }
    return "created";
  }

  // action.kind === "update"
  const { error } = await args.service
    .from("leads")
    .update(action.patch as never)
    .eq("id", action.leadId);
  if (error) throw new Error(`GHL update lead: ${error.message}`);
  return "updated";
}

// ─── helpers ───────────────────────────────────────────────────────────────

function normalize(raw: string | null, country: CountryCode): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const parsed = parsePhoneNumberFromString(trimmed, country);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.format("E.164");
}

function buildAppointmentNotes(e: GhlAppointment): string | null {
  if (!e.startTime) return null;
  return `GHL appointment ${e.id} — comienza ${e.startTime}`;
}

function buildConversationNotes(c: GhlConversation): string | null {
  if (!c.lastMessageDate) return null;
  return `GHL ${c.type ?? "WhatsApp"} conversación ${c.id} — último mensaje ${c.lastMessageDate}`;
}

function propagateFailure<T>(failure: Extract<GhlFetchResult<T>, { ok: false }>): GhlRunSummary {
  return {
    ok: false,
    kind: failure.kind,
    message: failure.message,
    detail: failure.detail,
    retryAfterSeconds: failure.retryAfterSeconds ?? null,
  };
}

function isUniqueViolation(code: string | undefined): boolean {
  // Postgres unique_violation. PostgREST devuelve este code en `error.code`.
  return code === "23505";
}
