import { NextResponse } from "next/server";

import { GHL_API_BASE, GHL_API_VERSION } from "@/lib/integrations/ghl";
import { getLaunch } from "@/lib/launches/get";
import { requireCanEditLaunchesIn } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/proyectos/[projectId]/launches/[launchId]/probes/ghl-messages
 *
 * Probe diagnóstico (Fase B Gate B). Lee shape REAL de `/conversations/search`
 * y `/conversations/{id}/messages` para confirmar:
 *   - cómo entra el WhatsApp App-level (¿type "SMS"? ¿"TYPE_WHATSAPP"?)
 *   - nombre del campo de dirección por mensaje (esperado: `direction`)
 *   - nombre del campo de fecha por mensaje
 *
 * NO usa el filtro `lastMessageType=TYPE_WHATSAPP` que sí usa el sync vigente
 * — el punto del probe es ver qué types vienen sin asumir nada.
 *
 * Sanitización: NO devuelve teléfonos, emails, ni bodies de mensajes. Solo
 * keys + valores de campos de control (id enmascarado, type, direction, fecha).
 */
export async function GET(
  _request: Request,
  {
    params,
  }: { params: Promise<{ projectId: string; launchId: string }> },
): Promise<NextResponse> {
  const { projectId, launchId } = await params;
  await requireCanEditLaunchesIn(projectId);

  const launch = await getLaunch(launchId);
  if (!launch || launch.project_id !== projectId) {
    return NextResponse.json(
      { error: "Lanzamiento no encontrado" },
      { status: 404 },
    );
  }

  const cfg = readGhlConfig(launch.integration_config);
  if (!cfg.location_id) {
    return NextResponse.json(
      { error: "Falta GHL location_id en integration_config" },
      { status: 400 },
    );
  }

  const service = createServiceClient();
  const secretRes = await service
    .from("launch_secrets")
    .select("secret")
    .eq("launch_id", launchId)
    .eq("provider", "ghl")
    .maybeSingle();
  const token = (secretRes.data as { secret: string } | null)?.secret ?? null;
  if (!token) {
    return NextResponse.json(
      { error: "Falta el GHL PIT secret para este launch" },
      { status: 400 },
    );
  }

  // 1) /conversations/search — SIN filtro de type.
  //    Solo limit=10 y orden desc por last_message_date para agarrar las más
  //    recientes (mayor chance de tener mensajes inbound en la ventana).
  const searchParams = new URLSearchParams({
    locationId: cfg.location_id,
    limit: "10",
    sort: "desc",
    sortBy: "last_message_date",
  });
  const searchUrl = `${GHL_API_BASE}/conversations/search?${searchParams.toString()}`;
  const searchRes = await ghlGet(searchUrl, token);
  if (!searchRes.ok) {
    return NextResponse.json(
      {
        error: "Fallo al pedir /conversations/search",
        http_status: searchRes.status,
        body: searchRes.body,
      },
      { status: 502 },
    );
  }

  const searchBody = searchRes.body as Record<string, unknown> | null;
  const convsExtraction = extractArrayWithEnvelope(searchBody, "conversations");
  const convsArr = convsExtraction.values;
  const searchResponseKeys = searchBody ? Object.keys(searchBody) : [];

  // Capturamos los types observados en TODAS las conversaciones — no solo en
  // las 3 que vamos a samplear. Si vienen 10 y todas son SMS, eso es la
  // respuesta.
  const observedConvTypes = new Set<string>();
  const observedLastMessageTypes = new Set<string>();
  const observedDirections = new Set<string>();
  for (const c of convsArr) {
    if (typeof c !== "object" || c === null) continue;
    const rec = c as Record<string, unknown>;
    if (typeof rec.type === "string") observedConvTypes.add(rec.type);
    if (typeof rec.lastMessageType === "string")
      observedLastMessageTypes.add(rec.lastMessageType);
    if (typeof rec.lastMessageDirection === "string")
      observedDirections.add(rec.lastMessageDirection);
  }

  const sampleConvKeys =
    convsArr[0] && typeof convsArr[0] === "object"
      ? Object.keys(convsArr[0] as Record<string, unknown>)
      : [];

  // 2) Para hasta 3 conversaciones, pedimos /conversations/{id}/messages.
  //    No filtramos por ventana del launch acá — el probe es para shape, no
  //    para producción. Devolvemos lo que GHL dé.
  const PROBE_CONV_LIMIT = 3;
  const PROBE_MSG_LIMIT = 10;
  const probedConversations: ProbedConversation[] = [];

  for (const item of convsArr.slice(0, PROBE_CONV_LIMIT)) {
    if (typeof item !== "object" || item === null) continue;
    const conv = item as Record<string, unknown>;
    const convId =
      typeof conv.id === "string" && conv.id.length > 0 ? conv.id : null;
    if (!convId) continue;

    const msgParams = new URLSearchParams({ limit: String(PROBE_MSG_LIMIT) });
    const msgUrl = `${GHL_API_BASE}/conversations/${encodeURIComponent(
      convId,
    )}/messages?${msgParams.toString()}`;
    const msgRes = await ghlGet(msgUrl, token);
    if (!msgRes.ok) {
      probedConversations.push({
        conv_id_masked: maskId(convId),
        conv_type: typeof conv.type === "string" ? conv.type : null,
        conv_lastMessageType:
          typeof conv.lastMessageType === "string" ? conv.lastMessageType : null,
        conv_lastMessageDirection:
          typeof conv.lastMessageDirection === "string"
            ? conv.lastMessageDirection
            : null,
        conv_lastMessageDate: pickDateValue(conv.lastMessageDate),
        messages_error: { http_status: msgRes.status, body: msgRes.body },
        messages_response_keys: [],
        messages_envelope_path: null,
        messages_inner_keys: [],
        sample_message_keys: [],
        messages_sample: [],
        messages_observed_types: [],
        messages_observed_directions: [],
        messages_observed_date_keys: [],
      });
      continue;
    }

    const msgBody = msgRes.body as Record<string, unknown> | null;
    const msgExtraction = extractArrayWithEnvelope(msgBody, "messages");
    const messagesArr = msgExtraction.values;
    const messagesResponseKeys = msgBody ? Object.keys(msgBody) : [];
    const sampleMsgKeys =
      messagesArr[0] && typeof messagesArr[0] === "object"
        ? Object.keys(messagesArr[0] as Record<string, unknown>)
        : [];

    const observedMessageTypes = new Set<string>();
    const observedMessageDirections = new Set<string>();
    const observedMessageDateKeys = new Set<string>();
    const sample: SanitizedMessageSample[] = [];

    for (const m of messagesArr) {
      if (typeof m !== "object" || m === null) continue;
      const msg = m as Record<string, unknown>;
      if (typeof msg.type === "string") observedMessageTypes.add(msg.type);
      if (typeof msg.messageType === "string")
        observedMessageTypes.add(`messageType=${msg.messageType}`);
      if (typeof msg.direction === "string")
        observedMessageDirections.add(msg.direction);

      // Anotamos todas las keys que parecen ser fecha (terminan en "Date",
      // "At", "Time" o se llaman "date"/"dateAdded"/"dateUpdated").
      // Después miramos qué nombre exacto usó GHL.
      for (const k of Object.keys(msg)) {
        if (
          /date|time|at$/i.test(k) ||
          k === "createdAt" ||
          k === "updatedAt"
        ) {
          observedMessageDateKeys.add(k);
        }
      }

      sample.push({
        // NO body ni attachments — solo metadata.
        id_masked: typeof msg.id === "string" ? maskId(msg.id) : null,
        type: typeof msg.type === "string" ? msg.type : null,
        messageType:
          typeof msg.messageType === "string" ? msg.messageType : null,
        direction: typeof msg.direction === "string" ? msg.direction : null,
        // Volcamos los valores de TODAS las keys que parecen fecha, para
        // ver cuál es la que viene poblada y con qué shape.
        date_like_values: dateLikeValues(msg),
        status: typeof msg.status === "string" ? msg.status : null,
        contentType:
          typeof msg.contentType === "string" ? msg.contentType : null,
      });
    }

    probedConversations.push({
      conv_id_masked: maskId(convId),
      conv_type: typeof conv.type === "string" ? conv.type : null,
      conv_lastMessageType:
        typeof conv.lastMessageType === "string"
          ? conv.lastMessageType
          : null,
      conv_lastMessageDirection:
        typeof conv.lastMessageDirection === "string"
          ? conv.lastMessageDirection
          : null,
      conv_lastMessageDate: pickDateValue(conv.lastMessageDate),
      messages_error: null,
      messages_response_keys: messagesResponseKeys,
      messages_envelope_path: msgExtraction.envelopePath,
      messages_inner_keys: msgExtraction.innerKeys,
      sample_message_keys: sampleMsgKeys,
      messages_sample: sample,
      messages_observed_types: Array.from(observedMessageTypes),
      messages_observed_directions: Array.from(observedMessageDirections),
      messages_observed_date_keys: Array.from(observedMessageDateKeys),
    });
  }

  return NextResponse.json({
    probe: "ghl-messages",
    launch_window: {
      date_start: launch.date_start,
      date_end: launch.date_end,
    },
    location_id_masked: maskId(cfg.location_id),
    search_response_keys: searchResponseKeys,
    conversations_returned: convsArr.length,
    sample_conversation_keys: sampleConvKeys,
    observed_conv_types: Array.from(observedConvTypes),
    observed_last_message_types: Array.from(observedLastMessageTypes),
    observed_last_message_directions: Array.from(observedDirections),
    probed: probedConversations,
  });
}

// ─── helpers ──────────────────────────────────────────────────────────────

interface ProbedConversation {
  conv_id_masked: string | null;
  conv_type: string | null;
  conv_lastMessageType: string | null;
  conv_lastMessageDirection: string | null;
  /** Devolvemos number (epoch ms) ó string ISO ó null — GHL usa number en search. */
  conv_lastMessageDate: number | string | null;
  messages_error: { http_status: number; body: unknown } | null;
  messages_response_keys: string[];
  /**
   * Path donde efectivamente encontramos el array. Valores:
   *   "messages"          → body.messages = [...]
   *   "messages.messages" → body.messages.messages = [...] (envelope anidado)
   *   "data"              → body.data = [...] (fallback)
   *   null                → no encontramos array de mensajes
   */
  messages_envelope_path: string | null;
  /** Si body.messages es un objeto, sus keys — para confirmar shape del envelope. */
  messages_inner_keys: string[];
  sample_message_keys: string[];
  messages_sample: SanitizedMessageSample[];
  messages_observed_types: string[];
  messages_observed_directions: string[];
  messages_observed_date_keys: string[];
}

interface SanitizedMessageSample {
  id_masked: string | null;
  type: string | null;
  messageType: string | null;
  direction: string | null;
  date_like_values: Record<string, unknown>;
  status: string | null;
  contentType: string | null;
}

function readGhlConfig(blob: unknown): { location_id: string | null } {
  if (blob === null || typeof blob !== "object") return { location_id: null };
  const cfg = (blob as Record<string, unknown>).ghl;
  if (cfg === null || typeof cfg !== "object") return { location_id: null };
  const rec = cfg as Record<string, unknown>;
  return {
    location_id:
      typeof rec.location_id === "string" ? rec.location_id : null,
  };
}

function extractArray(body: unknown, key: string): unknown[] {
  if (body === null || typeof body !== "object") return [];
  const rec = body as Record<string, unknown>;
  if (Array.isArray(rec[key])) return rec[key] as unknown[];
  return [];
}

/**
 * Versión envelope-aware. GHL devuelve a veces el array directo
 * (`{ messages: [...] }`) y a veces lo anida un nivel adentro
 * (`{ messages: { messages: [...], lastMessageId, nextPage } }`). El probe
 * tiene que sobrevivir ambos casos sin perder el shape.
 *
 * Devuelve `values` + el `envelopePath` donde lo encontró (para diagnóstico)
 * + `innerKeys` (las keys del envelope, vacío si no había envelope).
 */
function extractArrayWithEnvelope(
  body: unknown,
  key: string,
): { values: unknown[]; envelopePath: string | null; innerKeys: string[] } {
  if (body === null || typeof body !== "object") {
    return { values: [], envelopePath: null, innerKeys: [] };
  }
  const rec = body as Record<string, unknown>;

  // 1) Path directo: body[key] = [...]
  if (Array.isArray(rec[key])) {
    return { values: rec[key] as unknown[], envelopePath: key, innerKeys: [] };
  }

  // 2) Envelope: body[key] = { ...keys..., [key]: [...] | data: [...] }
  if (rec[key] !== null && typeof rec[key] === "object") {
    const inner = rec[key] as Record<string, unknown>;
    const innerKeys = Object.keys(inner);

    if (Array.isArray(inner[key])) {
      return {
        values: inner[key] as unknown[],
        envelopePath: `${key}.${key}`,
        innerKeys,
      };
    }
    if (Array.isArray(inner.data)) {
      return {
        values: inner.data as unknown[],
        envelopePath: `${key}.data`,
        innerKeys,
      };
    }
    return { values: [], envelopePath: null, innerKeys };
  }

  // 3) Fallback: body.data = [...]
  if (Array.isArray(rec.data)) {
    return {
      values: rec.data as unknown[],
      envelopePath: "data",
      innerKeys: [],
    };
  }

  return { values: [], envelopePath: null, innerKeys: [] };
}

/**
 * GHL en search devuelve `lastMessageDate` como epoch ms (number). Mi probe
 * inicial filtraba por `typeof === "string"` y lo descartaba. Acá aceptamos
 * ambos: si es number, lo devolvemos tal cual (la UI ya lo lee como ms).
 */
function pickDateValue(v: unknown): number | string | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.length > 0) return v;
  return null;
}

function maskId(id: string): string {
  if (id.length <= 8) return `${id.slice(0, 2)}…${id.slice(-2)}`;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

function dateLikeValues(msg: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(msg)) {
    if (/date|time|at$/i.test(k) || k === "createdAt" || k === "updatedAt") {
      if (typeof v === "string" || typeof v === "number") {
        out[k] = v;
      } else if (v === null) {
        out[k] = null;
      } else {
        out[k] = `<typeof ${typeof v}>`;
      }
    }
  }
  return out;
}

interface GhlGetResult {
  ok: boolean;
  status: number;
  body: unknown;
}

async function ghlGet(url: string, token: string): Promise<GhlGetResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Version: GHL_API_VERSION,
        Accept: "application/json",
      },
      cache: "no-store",
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: {
        cause: "network",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, body };
}
