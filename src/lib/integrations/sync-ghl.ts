import "server-only";

import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

import {
  fetchGhlContacts,
  fetchGhlContactCountsByDay,
  fetchGhlConversations,
  type ContactsMeta,
  type ConversationsMeta,
  type DailyLeadCountsMeta,
  type GhlFetchFailure,
} from "./ghl";

import type { createServiceClient } from "@/lib/supabase/service";

/**
 * Sync GHL — flujo mínimo (post-refactor 2026-08-10).
 *
 * Objetivo único: mantener actualizado `leads.team_member_id` en función de la
 * asignación que GHL tiene para cada contacto que tuvo actividad dentro de
 * la ventana compra+cierre del launch. El ranking del panel comercial lee
 * `leads.team_member_id`, así que este sync es lo que alimenta ese número.
 *
 * Lo que hace:
 *   1) Lee `ghl_user_mappings` (ghl_user_id → team_member_id).
 *   2) En paralelo, pagina `/contacts/` (incremental por dateUpdated) y
 *      `/conversations/search?lastMessageType=TYPE_WHATSAPP` (incremental por
 *      lastMessageDate), ambos filtrados a compra+cierre.
 *   3) Une por `contactId` los dos fetches — cada contact que aparezca en
 *      alguno cuenta como "activo en la ventana". Preferimos el shape del
 *      /contacts/ cuando existe (trae `country` para normalizar el phone).
 *   4) Para cada `assignedTo` mapeable, busca al lead existente por
 *      `external_id` o `phone_normalized` (bulk lookup, 1-2 queries) y
 *      UPDATEa `team_member_id` respetando la regla "manual gana".
 *
 * Lo que NO hace (deliberado):
 *   - No crea leads: los leads los alimenta Meta (formularios de campaña) y
 *     la carga manual de orgánicos. Un contact GHL sin match en DB se ignora.
 *   - No toca `status` del lead (frío/tibio/agendado/cerrado): el estado del
 *     lead viene de la venta cargada, no del sync.
 *   - No baja opportunities ni appointments ni users (para el sync). El
 *     endpoint /users/ se sigue exponiendo desde ghl.ts para el modal UI de
 *     mapeo de vendedores — no lo llama este archivo.
 *
 * Regla "manual gana": si el lead ya tiene `team_member_id` set (por asignación
 * manual desde la UI o por un sync previo), no lo pisamos. Solo escribimos
 * cuando el campo estaba NULL. Esto evita clobber de asignaciones que el
 * operador tocó a mano.
 */

type ServiceClient = ReturnType<typeof createServiceClient>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseClient = { from: (name: string) => any };
function loose(service: ServiceClient): LooseClient {
  return service as unknown as LooseClient;
}

export interface ExistingLeadView {
  id: string;
  team_member_id: string | null;
  external_id: string | null;
  phone_normalized: string | null;
}

export interface GhlCombinedCounts {
  /**
   * Filas devueltas por `/contacts/` en compra+cierre — usadas SOLO para el
   * team_member update. Fuera de compra+cierre no se piden.
   */
  contacts_fetched: number;
  /**
   * Filas devueltas por `/conversations/search` filtradas a compra+cierre.
   * Alimentan la señal "hablaron en la ventana" para el team_member update.
   */
  conversations_fetched: number;
  /**
   * Leads nuevos en el launch según GHL: `total` acumulado de
   * `POST /contacts/search` con filtro `dateAdded` por día × N días del
   * launch. NO trae el payload de los contacts — solo el count. Este es el
   * número que el usuario compara contra las ventas cerradas.
   */
  new_leads_in_launch: number;
  /**
   * Contacts (dedup por id, union de las dos fuentes) con `assignedTo`
   * poblado que además mapea a un `team_member_id` conocido. Solo cuenta
   * los que tuvieron actividad DENTRO de compra+cierre.
   */
  targets_with_mapping: number;
  /** Leads existentes que matchearon (por external_id o phone) con un target. */
  leads_matched: number;
  /** UPDATEs efectivamente ejecutados sobre `leads.team_member_id`. */
  leads_updated: number;
  /** Matches donde el lead ya tenía team_member_id — saltados por manual-gana. */
  leads_skipped_manual: number;
}

export type GhlPaginatedEndpoint = "contacts" | "conversations";

interface GhlSuccessfulRunBody {
  counts: GhlCombinedCounts;
  meta: GhlRunMeta;
}

export type GhlRunSummary =
  | (GhlSuccessfulRunBody & {
      status: "success";
      hitMaxPages: readonly [];
    })
  | (GhlSuccessfulRunBody & {
      status: "partial";
      hitMaxPages: ReadonlyArray<GhlPaginatedEndpoint>;
    })
  | {
      status: "token_invalid" | "rate_limited" | "error";
      stage: "contacts" | "conversations" | "mappings" | "updates";
      message: string;
      detail: Record<string, unknown>;
      retryAfterSeconds?: number | null;
    };

interface GhlRunMeta {
  contacts: ContactsMeta;
  conversations: ConversationsMeta;
  /**
   * Meta del fetch por día del count. Un request por día del launch — barato
   * comparado con paginar `/contacts/` sobre la ventana completa.
   */
  daily_counts: DailyLeadCountsMeta;
  /** Cuántos `assignedTo` distintos se resolvieron a team_member vía mapping. */
  mappings_applied: number;
  /**
   * GHL user ids vistos como `assignedTo` pero SIN fila en
   * `ghl_user_mappings`. Cap 20 para no inflar la respuesta. Útil para saber
   * "por qué el ranking dice X leads en lugar de Y".
   */
  unmapped_ghl_user_ids: string[];
  /**
   * Ventana completa del launch — la usada para el fetch de contacts y el
   * count de leads nuevos.
   */
  launch_window: { start: string; end: string };
  /**
   * Sub-ventana compra+cierre usada para los updates de team_member_id.
   * Un contact/conversation es "activo" y activa el update solo si su
   * dateUpdated/lastMessageDate cae acá.
   */
  warm_window: { start: string; end: string };
}

export interface RunGhlSyncArgs {
  service: ServiceClient;
  token: string;
  locationId: string;
  defaultCountry: string;
  projectId: string;
  launchId: string;
  since: string;
  until: string;
  /**
   * Sub-ventana compra+cierre. Si null, fallback a `[since, until]`. El sync
   * SIEMPRE opera sobre esta ventana — no procesa nada fuera de compra+cierre.
   */
  warmWindow?: { start: string; end: string } | null;
  lastSuccessAt?: string | null;
}

const BULK_LOOKUP_CHUNK = 1000;
const UPDATE_CONCURRENCY = 10;
const UNMAPPED_SAMPLE_LIMIT = 20;

export async function runGhlSync(args: RunGhlSyncArgs): Promise<GhlRunSummary> {
  const launchWindow = { start: args.since, end: args.until };
  const warmWindow = args.warmWindow ?? launchWindow;
  const cutoffIso = args.lastSuccessAt ?? null;
  const warmStartMs = Date.parse(`${warmWindow.start}T00:00:00.000Z`);
  const warmEndMs = Date.parse(`${warmWindow.end}T23:59:59.999Z`);

  // 1) Mappings GHL user → team_member del proyecto.
  const mappingRes = await loose(args.service)
    .from("ghl_user_mappings")
    .select("ghl_user_id, team_member_id")
    .eq("project_id", args.projectId);
  if (mappingRes.error) {
    return {
      status: "error",
      stage: "mappings",
      message: `No pude leer ghl_user_mappings: ${mappingRes.error.message}`,
      detail: { code: mappingRes.error.code ?? null },
    };
  }
  const mappings = new Map<string, string>(
    ((mappingRes.data ?? []) as Array<{ ghl_user_id: string; team_member_id: string }>).map(
      (m) => [m.ghl_user_id, m.team_member_id],
    ),
  );

  // 2) Fetch en paralelo:
  //    - Daily counts: `POST /contacts/search` por día del launch, pageLimit=1,
  //      trae SOLO el total (no descargamos nombre, phone, tags de cada
  //      contact). Un request por día → ~30-45 requests para un launch típico.
  //    - Contacts en warmWindow (compra+cierre): usados exclusivamente para
  //      el team_member update. Cuando el launch todavía está en
  //      captación/nutrición esta ventana está en el futuro y el fetch
  //      cortocircuita casi sin pedir páginas.
  //    - Conversations en warmWindow: para detectar leads que hablaron pero
  //      cuyo contact no fue re-tageado por un workflow.
  const [dailyCountsResult, contactsResult, conversationsResult] =
    await Promise.all([
      fetchGhlContactCountsByDay({
        token: args.token,
        locationId: args.locationId,
        since: launchWindow.start,
        until: launchWindow.end,
      }),
      fetchGhlContacts({
        token: args.token,
        locationId: args.locationId,
        since: warmWindow.start,
        until: warmWindow.end,
        cutoffIso,
      }),
      fetchGhlConversations({
        token: args.token,
        locationId: args.locationId,
        since: warmWindow.start,
        until: warmWindow.end,
        cutoffIso,
      }),
    ]);
  if (!dailyCountsResult.ok) return propagateFailure(dailyCountsResult, "contacts");
  if (!contactsResult.ok) return propagateFailure(contactsResult, "contacts");
  if (!conversationsResult.ok) {
    return propagateFailure(conversationsResult, "conversations");
  }

  // 3) Persistir el count por día en launch_daily_ads con provider='ghl'.
  //    mergeDailyData ignora ese provider (solo mira meta/google/tiktok), así
  //    que estos leads NO se suman a los de Meta en el KPI de leads totales.
  //    La UI los lee aparte (KPI card + curva propia en la gráfica).
  let newLeadsInLaunch = 0;
  const nowIso = new Date().toISOString();
  const dailyRowsToUpsert: Record<string, unknown>[] = [];
  for (const r of dailyCountsResult.rows) {
    newLeadsInLaunch += r.total;
    if (r.total === 0) continue; // no upsertear días sin leads
    dailyRowsToUpsert.push({
      launch_id: args.launchId,
      date: r.date,
      provider: "ghl",
      spend: 0,
      impressions: 0,
      clicks: 0,
      leads: r.total,
      // raw es NOT NULL con default '{}'. Sin payload crudo real para
      // guardar acá (usamos POST /contacts/search solo por el count).
      raw: {},
      synced_at: nowIso,
    });
  }

  if (dailyRowsToUpsert.length > 0) {
    const upsert = await loose(args.service)
      .from("launch_daily_ads")
      .upsert(dailyRowsToUpsert, { onConflict: "launch_id,date,provider" });
    if (upsert.error) {
      return {
        status: "error",
        stage: "updates",
        message: `Falló el upsert de leads GHL por día: ${upsert.error.message}`,
        detail: {
          code: upsert.error.code ?? null,
          rows_attempted: dailyRowsToUpsert.length,
        },
      };
    }
  }

  // 3b) Union por contactId de las señales de ACTIVIDAD en warmWindow. Un
  //     contact activa el team_member update si:
  //       - su dateUpdated cae en warmWindow (workflow tocó tag / lo editaron)
  //       - o alguna conversación suya tiene lastMessageDate en warmWindow
  //         (GHL no bumpea dateUpdated cuando el lead escribe puro WhatsApp).
  //     El shape de contacts prevalece por sobre el de conversations cuando
  //     ambas fuentes tienen el mismo contactId (contacts trae `country` para
  //     normalizar phone con región correcta).
  interface Target {
    contactId: string;
    phone: string | null;
    assignedTo: string | null;
  }
  const byContactId = new Map<string, Target>();
  for (const conv of conversationsResult.rows) {
    if (!conv.contactId) continue;
    if (byContactId.has(conv.contactId)) continue;
    byContactId.set(conv.contactId, {
      contactId: conv.contactId,
      phone: normalize(conv.rawPhone, undefined),
      assignedTo: conv.assignedTo,
    });
  }
  for (const c of contactsResult.rows) {
    const updatedMs = c.dateUpdated ? Date.parse(c.dateUpdated) : NaN;
    const activeInWarm =
      Number.isFinite(updatedMs) &&
      updatedMs >= warmStartMs &&
      updatedMs <= warmEndMs;
    // Si el contact NO está activo en warmWindow y NO había caído por
    // conversación, no lo procesamos para el team update — cae solo en el
    // count del paso 3a.
    if (!activeInWarm && !byContactId.has(c.id)) continue;
    byContactId.set(c.id, {
      contactId: c.id,
      phone: normalize(c.rawPhone, asCountryCode(c.country)),
      assignedTo: c.assignedTo,
    });
  }

  // 4) Filtrar a los que tienen assignedTo mapeable. Los que no mapean quedan
  //    registrados para diagnóstico en `unmapped_ghl_user_ids`.
  const unmappedGhlUserIds = new Set<string>();
  interface ResolvedTarget {
    contactId: string;
    phone: string | null;
    teamMemberId: string;
  }
  const resolvedTargets: ResolvedTarget[] = [];
  for (const t of byContactId.values()) {
    if (!t.assignedTo) continue;
    const teamMemberId = mappings.get(t.assignedTo);
    if (!teamMemberId) {
      if (unmappedGhlUserIds.size < UNMAPPED_SAMPLE_LIMIT) {
        unmappedGhlUserIds.add(t.assignedTo);
      }
      continue;
    }
    resolvedTargets.push({
      contactId: t.contactId,
      phone: t.phone,
      teamMemberId,
    });
  }

  // 5) Bulk lookup de leads existentes. Match por external_id (matcheo exacto
  //    contra syncs previos que ya linkearon el contact) o phone_normalized
  //    (Meta leads / orgánicos que nunca vieron GHL).
  const externalIds = resolvedTargets.map((t) => t.contactId);
  const phones = resolvedTargets
    .map((t) => t.phone)
    .filter((p): p is string => p !== null);
  const lookup = await buildLeadLookup({
    service: args.service,
    projectId: args.projectId,
    externalIds,
    phoneNormalizeds: phones,
  });

  // 6) Decide qué updatear. Manual gana: si el lead ya tiene team_member_id,
  //    no lo pisamos. Solo escribimos donde estaba NULL y el mapeo trae valor.
  interface PendingUpdate {
    leadId: string;
    teamMemberId: string;
  }
  const pendingUpdates: PendingUpdate[] = [];
  let leadsMatched = 0;
  let leadsSkippedManual = 0;
  for (const t of resolvedTargets) {
    const existing =
      lookup.byExternalKey.get(`ghl:${t.contactId}`) ??
      (t.phone ? lookup.byPhone.get(t.phone) : undefined);
    if (!existing) continue;
    leadsMatched++;

    const shouldWrite = resolveTeamMemberAssignment(existing, t.teamMemberId);
    if (shouldWrite === undefined) {
      leadsSkippedManual++;
      continue;
    }
    pendingUpdates.push({ leadId: existing.id, teamMemberId: shouldWrite });
  }

  // 7) UPDATEs en paralelo con concurrency limitada. Cada update es 1 row —
  //    no hay ganancia neta de un bulk UPDATE (Supabase no tiene una
  //    primitiva para "update N rows con N values distintos" en una sola
  //    llamada). 10 en paralelo es suficiente para ventanas típicas.
  let updated = 0;
  let firstUpdateError: string | null = null;
  await parallelMap(pendingUpdates, UPDATE_CONCURRENCY, async (u) => {
    const res = await loose(args.service)
      .from("leads")
      .update({ team_member_id: u.teamMemberId })
      .eq("id", u.leadId);
    if (res.error) {
      firstUpdateError = firstUpdateError ?? (res.error.message ?? "unknown");
      return;
    }
    updated++;
  });
  if (firstUpdateError !== null) {
    return {
      status: "error",
      stage: "updates",
      message: `Falló al menos un UPDATE de team_member_id: ${firstUpdateError}`,
      detail: { updated_before_failure: updated },
    };
  }

  const counts: GhlCombinedCounts = {
    contacts_fetched: contactsResult.rows.length,
    conversations_fetched: conversationsResult.rows.length,
    new_leads_in_launch: newLeadsInLaunch,
    targets_with_mapping: resolvedTargets.length,
    leads_matched: leadsMatched,
    leads_updated: updated,
    leads_skipped_manual: leadsSkippedManual,
  };
  const meta: GhlRunMeta = {
    contacts: contactsResult.meta,
    conversations: conversationsResult.meta,
    daily_counts: dailyCountsResult.meta,
    mappings_applied: resolvedTargets.length,
    unmapped_ghl_user_ids: Array.from(unmappedGhlUserIds),
    launch_window: launchWindow,
    warm_window: warmWindow,
  };

  const hitMaxPages: GhlPaginatedEndpoint[] = [];
  if (contactsResult.meta.hit_max_pages) hitMaxPages.push("contacts");
  if (conversationsResult.meta.hit_max_pages) hitMaxPages.push("conversations");

  if (hitMaxPages.length > 0) {
    return { status: "partial", hitMaxPages, counts, meta };
  }
  return { status: "success", hitMaxPages: [], counts, meta };
}

// ─── bulk lookup ───────────────────────────────────────────────────────────

interface LeadLookup {
  /** Key: `ghl:${externalId}` */
  byExternalKey: Map<string, ExistingLeadView>;
  /** Key: phone_normalized */
  byPhone: Map<string, ExistingLeadView>;
}

interface BuildLookupArgs {
  service: ServiceClient;
  projectId: string;
  externalIds: ReadonlyArray<string>;
  phoneNormalizeds: ReadonlyArray<string>;
}

/**
 * Trae los leads que matchean (project_id, external_id) o
 * (project_id, phone_normalized) con 1-2 queries chunkadas. El match por phone
 * NO filtra por source — un lead que entró por Meta puede matchear contra un
 * GHL contact por teléfono. Ese es exactamente el caso que necesitamos para
 * el ranking: linkear leads Meta con la asignación GHL.
 */
async function buildLeadLookup(args: BuildLookupArgs): Promise<LeadLookup> {
  const byExternalKey = new Map<string, ExistingLeadView>();
  const byPhone = new Map<string, ExistingLeadView>();

  const externalIdChunks = chunk(uniqueStr(args.externalIds), BULK_LOOKUP_CHUNK);
  const phoneChunks = chunk(uniqueStr(args.phoneNormalizeds), BULK_LOOKUP_CHUNK);

  const queries: Promise<unknown>[] = [];

  for (const ids of externalIdChunks) {
    queries.push(
      (async () => {
        const res = await loose(args.service)
          .from("leads")
          .select("id, external_id, phone_normalized, team_member_id")
          .eq("project_id", args.projectId)
          .eq("source", "ghl")
          .in("external_id", ids);
        for (const row of ((res.data ?? []) as LeadRow[])) {
          const view: ExistingLeadView = {
            id: row.id,
            team_member_id: row.team_member_id,
            external_id: row.external_id,
            phone_normalized: row.phone_normalized,
          };
          if (row.external_id) {
            byExternalKey.set(`ghl:${row.external_id}`, view);
          }
          if (row.phone_normalized) {
            byPhone.set(row.phone_normalized, view);
          }
        }
      })(),
    );
  }

  for (const phones of phoneChunks) {
    queries.push(
      (async () => {
        // Cross-source: NO filtramos por source — un lead Meta puede tener
        // el mismo phone que el GHL contact. Ordenamos por created_at desc
        // para que el más reciente gane en caso de duplicados.
        const res = await loose(args.service)
          .from("leads")
          .select("id, external_id, phone_normalized, team_member_id")
          .eq("project_id", args.projectId)
          .in("phone_normalized", phones)
          .order("created_at", { ascending: false });
        for (const row of ((res.data ?? []) as LeadRow[])) {
          if (row.phone_normalized && !byPhone.has(row.phone_normalized)) {
            byPhone.set(row.phone_normalized, {
              id: row.id,
              team_member_id: row.team_member_id,
              external_id: row.external_id,
              phone_normalized: row.phone_normalized,
            });
          }
        }
      })(),
    );
  }

  await Promise.all(queries);
  return { byExternalKey, byPhone };
}

interface LeadRow {
  id: string;
  external_id: string | null;
  phone_normalized: string | null;
  team_member_id: string | null;
}

// ─── helpers ───────────────────────────────────────────────────────────────

async function parallelMap<T, R>(
  items: ReadonlyArray<T>,
  concurrency: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]!, i);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

function chunk<T>(arr: ReadonlyArray<T>, size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function uniqueStr(arr: ReadonlyArray<string>): string[] {
  return Array.from(new Set(arr));
}

/**
 * Normaliza un teléfono crudo a E.164.
 *
 * Sin país (undefined) parsea E.164-only: acepta "+5491112345678", rechaza
 * "11 1234-5678" local. Con país (ej. "AR") acepta el local y devuelve E.164.
 * Null significa "no pude normalizar sin meter un prefijo equivocado" — el
 * caller lo deja sin phone_normalized (mejor teléfono crudo que corrupto).
 */
export function normalize(
  raw: string | null,
  country: CountryCode | undefined,
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const parsed = parsePhoneNumberFromString(trimmed, country);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.format("E.164");
}

function asCountryCode(v: string | null | undefined): CountryCode | undefined {
  if (!v) return undefined;
  return v as CountryCode;
}

/**
 * Regla "manual gana": no pisar team_member_id existente. Solo escribimos
 * cuando el existing está en NULL (o string vacío defensivo) y la API trae
 * un valor mapeado.
 *
 *   - existing.team_member_id ya seteado → undefined (no tocar).
 *   - existing vacío + fromApi con valor → fromApi.
 *   - existing vacío + fromApi null/undefined → undefined (nunca escribir null).
 */
export function resolveTeamMemberAssignment(
  existing: ExistingLeadView | null,
  fromApi: string | null | undefined,
): string | undefined {
  if (existing && existing.team_member_id) return undefined;
  if (!fromApi) return undefined;
  return fromApi;
}

function propagateFailure(
  failure: GhlFetchFailure,
  stage: "contacts" | "conversations",
): GhlRunSummary {
  return {
    status: failure.kind,
    stage,
    message: failure.message,
    detail: failure.detail,
    retryAfterSeconds: failure.retryAfterSeconds ?? null,
  };
}
