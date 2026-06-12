import { describe, it, expect } from "vitest";

import { resolveMatchAction, type ExistingLeadView } from "./ghl-match";

/**
 * Reglas de transición del brief Fase 3b:
 *   - Appointment + lead existente no-terminal → status=agendado + pin.
 *   - Appointment + lead terminal (cerrado/perdido) → noop.
 *   - Appointment sin match → create source='ghl', status='agendado', pin.
 *   - WhatsApp + lead existente → solo pin (no toca status).
 *   - WhatsApp sin match → create source='whatsapp', status='nuevo', pin.
 */

const BASE_ARGS = {
  externalId: "ext-1",
  contactName: "Test User",
  phoneNormalized: "+5491155555555",
  rawPhone: "+5491155555555",
};

function existing(overrides: Partial<ExistingLeadView> = {}): ExistingLeadView {
  return {
    id: "lead-1",
    status: "nuevo",
    pinned_to_kanban: false,
    ...overrides,
  };
}

describe("resolveMatchAction — appointment", () => {
  it("lead existente no-terminal → update a 'agendado' + pin + external_id", () => {
    const action = resolveMatchAction({
      eventKind: "appointment",
      existing: existing({ status: "contactado" }),
      ...BASE_ARGS,
    });
    expect(action.kind).toBe("update");
    if (action.kind !== "update") return;
    expect(action.leadId).toBe("lead-1");
    expect(action.patch).toEqual({
      status: "agendado",
      pinned_to_kanban: true,
      external_id: "ext-1",
    });
  });

  it("lead ya en 'agendado' igual recibe pin + external_id (refresh)", () => {
    const action = resolveMatchAction({
      eventKind: "appointment",
      existing: existing({ status: "agendado", pinned_to_kanban: true }),
      ...BASE_ARGS,
    });
    expect(action.kind).toBe("update");
    if (action.kind !== "update") return;
    expect(action.patch.status).toBe("agendado");
    expect(action.patch.external_id).toBe("ext-1");
  });

  it("lead en 'cerrado' → noop (no toco terminales)", () => {
    const action = resolveMatchAction({
      eventKind: "appointment",
      existing: existing({ status: "cerrado" }),
      ...BASE_ARGS,
    });
    expect(action.kind).toBe("noop");
    if (action.kind !== "noop") return;
    expect(action.reason).toBe("lead_terminal");
  });

  it("lead en 'perdido' → noop", () => {
    const action = resolveMatchAction({
      eventKind: "appointment",
      existing: existing({ status: "perdido" }),
      ...BASE_ARGS,
    });
    expect(action.kind).toBe("noop");
  });

  it("sin lead → create source='ghl', status='agendado', pinned", () => {
    const action = resolveMatchAction({
      eventKind: "appointment",
      existing: null,
      ...BASE_ARGS,
    });
    expect(action.kind).toBe("create");
    if (action.kind !== "create") return;
    expect(action.payload.source).toBe("ghl");
    expect(action.payload.status).toBe("agendado");
    expect(action.payload.pinned_to_kanban).toBe(true);
    expect(action.payload.external_id).toBe("ext-1");
    expect(action.payload.phone_normalized).toBe("+5491155555555");
    expect(action.payload.name).toBe("Test User");
  });

  it("sin lead y sin phone normalizado → guarda rawPhone en `contact`", () => {
    const action = resolveMatchAction({
      eventKind: "appointment",
      existing: null,
      externalId: "ext-2",
      contactName: "Sin teléfono",
      phoneNormalized: null,
      rawPhone: "123-no-valido",
    });
    expect(action.kind).toBe("create");
    if (action.kind !== "create") return;
    expect(action.payload.phone_normalized).toBeNull();
    expect(action.payload.contact).toBe("123-no-valido");
  });
});

describe("resolveMatchAction — whatsapp", () => {
  it("lead existente → pin, NO cambia status", () => {
    const action = resolveMatchAction({
      eventKind: "whatsapp",
      existing: existing({ status: "calificado", pinned_to_kanban: false }),
      ...BASE_ARGS,
    });
    expect(action.kind).toBe("update");
    if (action.kind !== "update") return;
    // El brief es claro: WhatsApp NO cambia status, solo pin.
    expect(action.patch.status).toBeUndefined();
    expect(action.patch.pinned_to_kanban).toBe(true);
    expect(action.patch.external_id).toBe("ext-1");
  });

  it("lead terminal (cerrado/perdido) en WhatsApp → IGUAL pin (no es como appointment)", () => {
    // Decisión: WhatsApp es señal de actividad, no de etapa. Pinneamos
    // siempre — incluso si está cerrado, el operador puede querer verlo.
    const action = resolveMatchAction({
      eventKind: "whatsapp",
      existing: existing({ status: "cerrado", pinned_to_kanban: false }),
      ...BASE_ARGS,
    });
    expect(action.kind).toBe("update");
    if (action.kind !== "update") return;
    expect(action.patch.pinned_to_kanban).toBe(true);
    expect(action.patch.status).toBeUndefined();
  });

  it("sin lead → create source='whatsapp', status='nuevo', pinned", () => {
    const action = resolveMatchAction({
      eventKind: "whatsapp",
      existing: null,
      ...BASE_ARGS,
    });
    expect(action.kind).toBe("create");
    if (action.kind !== "create") return;
    expect(action.payload.source).toBe("whatsapp");
    expect(action.payload.status).toBe("nuevo");
    expect(action.payload.pinned_to_kanban).toBe(true);
  });
});
