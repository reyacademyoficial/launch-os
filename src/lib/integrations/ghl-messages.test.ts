import { describe, expect, it } from "vitest";

import {
  extractNestedMessages,
  isWhatsAppOrSmsMessageType,
} from "./ghl";

/**
 * Tests del adapter de mensajes inbound por día (Fase B). El fetch real lo
 * verifica el probe contra cuenta real; acá probamos los parsers puros que
 * mapean el shape verificado el 2026-06-23.
 */

describe("extractNestedMessages — envelope GHL", () => {
  it("envelope anidado: body.messages.messages = [...]", () => {
    // Shape REAL de /conversations/{id}/messages verificado con probe:
    // GHL anida los mensajes un nivel adentro de `messages`.
    const body = {
      messages: {
        lastMessageId: "abc",
        nextPage: false,
        messages: [
          { id: "m1", direction: "inbound" },
          { id: "m2", direction: "outbound" },
        ],
      },
      traceId: "trace-xyz",
    };
    const result = extractNestedMessages(body);
    expect(result).toHaveLength(2);
    expect((result[0] as { id: string }).id).toBe("m1");
  });

  it("shape plano (defensivo): body.messages = [...]", () => {
    // Algunos endpoints/versiones de GHL devuelven plano. El adapter banca
    // ambos casos sin distinguir.
    const body = {
      messages: [{ id: "m1" }, { id: "m2" }],
    };
    expect(extractNestedMessages(body)).toHaveLength(2);
  });

  it("body vacío / null / shape inválido → []", () => {
    expect(extractNestedMessages(null)).toEqual([]);
    expect(extractNestedMessages(undefined)).toEqual([]);
    expect(extractNestedMessages({})).toEqual([]);
    expect(extractNestedMessages({ messages: "string" })).toEqual([]);
    expect(extractNestedMessages({ messages: { foo: "bar" } })).toEqual([]);
  });
});

describe("isWhatsAppOrSmsMessageType — matcher familia", () => {
  it("captura las variantes SMS observadas en data real", () => {
    // Verificados 2026-06-23 contra location WDYpjQTiKpK6eUD1aFYZ.
    expect(isWhatsAppOrSmsMessageType("TYPE_SMS")).toBe(true);
    expect(isWhatsAppOrSmsMessageType("TYPE_CUSTOM_SMS")).toBe(true);
    // Futuras variantes que GHL pueda agregar — match por substring.
    expect(isWhatsAppOrSmsMessageType("TYPE_BUSINESS_SMS")).toBe(true);
    expect(isWhatsAppOrSmsMessageType("TYPE_OTHER_SMS_FOO")).toBe(true);
  });

  it("captura WhatsApp en cualquier casing", () => {
    expect(isWhatsAppOrSmsMessageType("TYPE_WHATSAPP")).toBe(true);
    expect(isWhatsAppOrSmsMessageType("Type_WhatsApp")).toBe(true);
    expect(isWhatsAppOrSmsMessageType("whatsapp_business")).toBe(true);
  });

  it("rechaza Instagram, Email y markers de sistema", () => {
    expect(isWhatsAppOrSmsMessageType("TYPE_INSTAGRAM")).toBe(false);
    expect(isWhatsAppOrSmsMessageType("TYPE_EMAIL")).toBe(false);
    expect(isWhatsAppOrSmsMessageType("TYPE_ACTIVITY_OPPORTUNITY")).toBe(false);
    expect(isWhatsAppOrSmsMessageType("TYPE_FACEBOOK")).toBe(false);
    expect(isWhatsAppOrSmsMessageType("TYPE_NO_SHOW")).toBe(false);
  });

  it("null / vacío / no string → false", () => {
    expect(isWhatsAppOrSmsMessageType(null)).toBe(false);
    expect(isWhatsAppOrSmsMessageType("")).toBe(false);
  });
});
