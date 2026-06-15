import { describe, it, expect } from "vitest";

import appointmentsHappy from "./__fixtures__/ghl/appointments_happy.json";
import conversationsHappy from "./__fixtures__/ghl/conversations_happy.json";
import emptyFixture from "./__fixtures__/ghl/empty.json";

import {
  parseAppointmentsBody,
  parseConversationsBody,
  parseOpportunitiesBody,
} from "./ghl";

/**
 * Tests del adapter de GHL. Mismo patrón que `meta.test.ts`: probamos los
 * parsers puros contra fixtures que reflejan el shape REAL de la API v2.
 * El `fetch` HTTP en sí lo valida la integración con cuenta real.
 *
 * NOTA: fixtures basados en la doc oficial vigente
 * (highlevel.stoplight.io, secciones Calendars / Conversations). Cuando se
 * pruebe contra cuenta real, dumps de respuestas reales pueden reemplazar
 * o complementar estos.
 */

describe("ghl.parseAppointmentsBody — happy path", () => {
  it("mapea cada appointment con id, phone, contactName y startTime", () => {
    const rows = parseAppointmentsBody(appointmentsHappy);
    expect(rows).toHaveLength(3);

    const first = rows[0]!;
    expect(first.id).toBe("evt_abc123");
    expect(first.rawPhone).toBe("+5491155555555");
    expect(first.contactName).toBe("María García");
    expect(first.startTime).toBe("2026-06-15T14:00:00.000Z");
  });

  it("extrae phone del nivel raíz cuando el contact no está anidado", () => {
    // El segundo evento del fixture tiene `phone` y `contactName` directo,
    // no anidados bajo `contact`. El adapter tiene que soportar ambos shapes
    // porque GHL no es consistente entre endpoints.
    const rows = parseAppointmentsBody(appointmentsHappy);
    const juan = rows[1]!;
    expect(juan.id).toBe("evt_def456");
    expect(juan.rawPhone).toBe("+5491144444444");
    expect(juan.contactName).toBe("Juan Pérez");
  });

  it("acepta eventos sin contacto y los marca como 'Contacto sin nombre'", () => {
    const rows = parseAppointmentsBody(appointmentsHappy);
    const bloqueo = rows[2]!;
    expect(bloqueo.id).toBe("evt_ghi789");
    expect(bloqueo.rawPhone).toBeNull();
    // El title del fixture es "Bloqueo personal" — extractContactName usa
    // title como segundo fallback antes del default.
    expect(bloqueo.contactName).toBe("Bloqueo personal");
  });
});

describe("ghl.parseAppointmentsBody — defensivo", () => {
  it("body vacío devuelve array vacío", () => {
    expect(parseAppointmentsBody(emptyFixture)).toEqual([]);
  });

  it("body que no es objeto devuelve array vacío", () => {
    expect(parseAppointmentsBody(null)).toEqual([]);
    expect(parseAppointmentsBody("string")).toEqual([]);
    expect(parseAppointmentsBody([])).toEqual([]);
  });

  it("eventos sin id se descartan en silencio", () => {
    const rows = parseAppointmentsBody({
      events: [
        { id: "ok", phone: "+5491155555555" },
        { phone: "+5491144444444" }, // sin id → descartado
        { id: "", phone: "+5491133333333" }, // id vacío → descartado
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("ok");
  });
});

// ─── conversations ─────────────────────────────────────────────────────────

describe("ghl.parseConversationsBody — happy path con filtro WhatsApp + ventana", () => {
  // Ventana: 2026-06-15 → 2026-06-20.
  const sinceMs = Date.parse("2026-06-15T00:00:00.000Z");
  const untilMs = Date.parse("2026-06-20T23:59:59.999Z");

  it("solo trae conversaciones type=TYPE_WHATSAPP dentro de la ventana", () => {
    const rows = parseConversationsBody(conversationsHappy, sinceMs, untilMs);

    // conv_aaa: WhatsApp, dentro → SÍ
    // conv_bbb: WhatsApp, dentro → SÍ
    // conv_ccc: EMAIL → descartada
    // conv_ddd: WhatsApp pero fuera de ventana → descartada
    expect(rows.map((r) => r.id)).toEqual(["conv_aaa", "conv_bbb"]);
  });

  it("mapea phone y contactName de fullName cuando viene", () => {
    const rows = parseConversationsBody(conversationsHappy, sinceMs, untilMs);
    const maria = rows[0]!;
    expect(maria.rawPhone).toBe("+5491155555555");
    expect(maria.contactName).toBe("María García");
    expect(maria.type).toBe("TYPE_WHATSAPP");
    expect(maria.lastMessageDate).toBe("2026-06-16T12:00:00.000Z");
  });
});

describe("ghl.parseConversationsBody — type matching tolerante", () => {
  const sinceMs = 0;
  const untilMs = Date.parse("2099-01-01T00:00:00.000Z");

  it("matchea cualquier type que contenga 'whatsapp' (case-insensitive)", () => {
    const rows = parseConversationsBody(
      {
        conversations: [
          { id: "a", type: "WhatsApp", phone: "+1" },
          { id: "b", type: "TYPE_WHATSAPP", phone: "+2" },
          { id: "c", type: "whatsapp_business", phone: "+3" },
          { id: "d", type: "TYPE_SMS", phone: "+4" },
          { id: "e", type: null, phone: "+5" },
        ],
      },
      sinceMs,
      untilMs,
    );
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});

describe("ghl.parseConversationsBody — defensivo", () => {
  it("body vacío devuelve array vacío", () => {
    expect(parseConversationsBody(emptyFixture, 0, Number.MAX_SAFE_INTEGER)).toEqual([]);
  });

  it("conversación con lastMessageDate no parseable se conserva (no descartar por shape raro)", () => {
    const rows = parseConversationsBody(
      {
        conversations: [
          {
            id: "x",
            type: "WhatsApp",
            phone: "+1",
            lastMessageDate: "fecha-invalida",
          },
        ],
      },
      0,
      Number.MAX_SAFE_INTEGER,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.lastMessageDate).toBe("fecha-invalida");
  });
});

// ─── opportunities ─────────────────────────────────────────────────────────

describe("ghl.parseOpportunitiesBody — happy path", () => {
  it("mapea status, monetaryValue y deriva won_at solo cuando status='won'", () => {
    const rows = parseOpportunitiesBody({
      opportunities: [
        {
          id: "opp_1",
          status: "won",
          monetaryValue: 1500.5,
          lastStatusChangeAt: "2026-06-15T10:00:00Z",
          contactId: "c_1",
          pipelineId: "p_a",
          pipelineStageId: "stage_won",
          source: "whatsapp",
          assignedTo: "user_x",
          createdAt: "2026-06-01T00:00:00Z",
          updatedAt: "2026-06-15T10:00:00Z",
        },
        {
          id: "opp_2",
          status: "lost",
          monetaryValue: 800,
          lastStatusChangeAt: "2026-06-20T11:00:00Z",
        },
        {
          id: "opp_3",
          status: "open",
          monetaryValue: 2000,
          lastStatusChangeAt: "2026-06-25T12:00:00Z",
        },
      ],
    });
    expect(rows).toHaveLength(3);

    expect(rows[0]!.id).toBe("opp_1");
    expect(rows[0]!.status).toBe("won");
    expect(rows[0]!.monetaryValue).toBe(1500.5);
    expect(rows[0]!.wonAt).toBe("2026-06-15T10:00:00Z");
    expect(rows[0]!.source).toBe("whatsapp");
    expect(rows[0]!.assignedTo).toBe("user_x");
    expect(rows[0]!.pipelineId).toBe("p_a");

    // status=lost o open NUNCA tienen wonAt — aunque GHL devuelva
    // lastStatusChangeAt, lo ignoramos porque no representa una venta.
    expect(rows[1]!.wonAt).toBeNull();
    expect(rows[2]!.wonAt).toBeNull();
  });

  it("monetaryValue como string (postgrest/GHL inconsistencia) se parsea como float", () => {
    const rows = parseOpportunitiesBody({
      opportunities: [
        {
          id: "opp_1",
          status: "won",
          monetaryValue: "1499.99",
          lastStatusChangeAt: "2026-06-15T10:00:00Z",
        },
      ],
    });
    expect(rows[0]!.monetaryValue).toBeCloseTo(1499.99, 2);
  });

  it("acepta snake_case (pipeline_id / contact_id / last_status_change_date) como fallback", () => {
    const rows = parseOpportunitiesBody({
      opportunities: [
        {
          id: "opp_1",
          status: "won",
          monetaryValue: 100,
          contact_id: "c_snake",
          pipeline_id: "p_snake",
          last_status_change_date: "2026-06-15T10:00:00Z",
        },
      ],
    });
    expect(rows[0]!.contactId).toBe("c_snake");
    expect(rows[0]!.pipelineId).toBe("p_snake");
    expect(rows[0]!.wonAt).toBe("2026-06-15T10:00:00Z");
  });
});

describe("ghl.parseOpportunitiesBody — defensivo", () => {
  it("body vacío o no-objeto devuelve array vacío", () => {
    expect(parseOpportunitiesBody(null)).toEqual([]);
    expect(parseOpportunitiesBody({})).toEqual([]);
    expect(parseOpportunitiesBody({ opportunities: [] })).toEqual([]);
  });

  it("filas sin id o con status desconocido se descartan silenciosamente", () => {
    const rows = parseOpportunitiesBody({
      opportunities: [
        { id: "ok", status: "won", monetaryValue: 100, lastStatusChangeAt: "2026-06-15T10:00:00Z" },
        { status: "won", monetaryValue: 200 }, // sin id → descartar
        { id: "bad-status", status: "pending", monetaryValue: 300 }, // status no canónico → descartar
        { id: "", status: "won", monetaryValue: 400 }, // id vacío → descartar
      ],
    });
    expect(rows.map((r) => r.id)).toEqual(["ok"]);
  });

  it("monetaryValue null queda como null (no se fuerza a 0)", () => {
    const rows = parseOpportunitiesBody({
      opportunities: [
        {
          id: "opp_1",
          status: "won",
          monetaryValue: null,
          lastStatusChangeAt: "2026-06-15T10:00:00Z",
        },
      ],
    });
    expect(rows[0]!.monetaryValue).toBeNull();
  });
});
