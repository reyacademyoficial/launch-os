import { describe, it, expect } from "vitest";

import { resolveMatchAction, type ExistingLeadView } from "./ghl-match";

/**
 * Reglas Fase 3b:
 *  - Appointment + lead no-terminal → agendado + pin.
 *  - Appointment + lead terminal → noop.
 *  - Appointment sin match → create source='ghl', agendado, pinned.
 *
 *  - WhatsApp 1 msg + sin lead → create source='whatsapp', frio, pinned.
 *  - WhatsApp 2+ msgs + sin lead → create source='whatsapp', tibio, pinned.
 *  - WhatsApp 1 msg + lead frio → queda frío (no degrada).
 *  - WhatsApp 2+ msgs + lead frio → sube a tibio.
 *  - WhatsApp 1 msg + lead tibio → no degrada.
 *  - WhatsApp + lead terminal → noop.
 *
 *  - Contact con tag 'cliente' + sin lead → create source='ghl', cerrado, pinned.
 *  - Contact con tag 'cliente' + lead no-terminal → cerrado + pin.
 *  - Contact con tag 'cliente' + lead terminal → noop.
 *  - Contact sin tag 'cliente' + sin lead → create source='ghl', frio, NO pinned.
 *  - Contact sin tag 'cliente' + lead existente → noop.
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
    status: "frio",
    pinned_to_kanban: false,
    ...overrides,
  };
}

// ─── Appointment ────────────────────────────────────────────────────────────

describe("resolveMatchAction — appointment", () => {
  it("lead frío existente → status='agendado' + pin + external_id", () => {
    const action = resolveMatchAction({
      eventKind: "appointment",
      existing: existing({ status: "frio" }),
      ...BASE_ARGS,
    });
    expect(action.kind).toBe("update");
    if (action.kind !== "update") return;
    expect(action.patch).toEqual({
      status: "agendado",
      pinned_to_kanban: true,
      external_id: "ext-1",
    });
  });

  it("lead tibio existente → status='agendado' + pin", () => {
    const action = resolveMatchAction({
      eventKind: "appointment",
      existing: existing({ status: "tibio" }),
      ...BASE_ARGS,
    });
    expect(action.kind).toBe("update");
    if (action.kind !== "update") return;
    expect(action.patch.status).toBe("agendado");
  });

  it("lead cerrado → noop", () => {
    const action = resolveMatchAction({
      eventKind: "appointment",
      existing: existing({ status: "cerrado" }),
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
  });
});

// ─── WhatsApp ────────────────────────────────────────────────────────────────

describe("resolveMatchAction — whatsapp con conteo de mensajes inbound", () => {
  it("1 mensaje + sin lead → create frio pinned", () => {
    const action = resolveMatchAction({
      eventKind: "whatsapp",
      existing: null,
      inboundMessageCount: 1,
      ...BASE_ARGS,
    });
    expect(action.kind).toBe("create");
    if (action.kind !== "create") return;
    expect(action.payload.status).toBe("frio");
    expect(action.payload.pinned_to_kanban).toBe(true);
    expect(action.payload.source).toBe("whatsapp");
  });

  it("2 mensajes + sin lead → create tibio pinned", () => {
    const action = resolveMatchAction({
      eventKind: "whatsapp",
      existing: null,
      inboundMessageCount: 2,
      ...BASE_ARGS,
    });
    expect(action.kind).toBe("create");
    if (action.kind !== "create") return;
    expect(action.payload.status).toBe("tibio");
  });

  it("count=null → fallback a frio", () => {
    const action = resolveMatchAction({
      eventKind: "whatsapp",
      existing: null,
      inboundMessageCount: null,
      ...BASE_ARGS,
    });
    expect(action.kind).toBe("create");
    if (action.kind !== "create") return;
    expect(action.payload.status).toBe("frio");
  });

  it("1 mensaje + lead frio → no toca status, solo pin + external_id", () => {
    const action = resolveMatchAction({
      eventKind: "whatsapp",
      existing: existing({ status: "frio" }),
      inboundMessageCount: 1,
      ...BASE_ARGS,
    });
    expect(action.kind).toBe("update");
    if (action.kind !== "update") return;
    expect(action.patch.status).toBeUndefined();
    expect(action.patch.pinned_to_kanban).toBe(true);
  });

  it("2 mensajes + lead frio → sube a tibio", () => {
    const action = resolveMatchAction({
      eventKind: "whatsapp",
      existing: existing({ status: "frio" }),
      inboundMessageCount: 2,
      ...BASE_ARGS,
    });
    expect(action.kind).toBe("update");
    if (action.kind !== "update") return;
    expect(action.patch.status).toBe("tibio");
  });

  it("1 mensaje + lead tibio → NO degrada", () => {
    const action = resolveMatchAction({
      eventKind: "whatsapp",
      existing: existing({ status: "tibio" }),
      inboundMessageCount: 1,
      ...BASE_ARGS,
    });
    expect(action.kind).toBe("update");
    if (action.kind !== "update") return;
    expect(action.patch.status).toBeUndefined(); // queda tibio
  });

  it("lead cerrado → noop", () => {
    const action = resolveMatchAction({
      eventKind: "whatsapp",
      existing: existing({ status: "cerrado" }),
      inboundMessageCount: 3,
      ...BASE_ARGS,
    });
    expect(action.kind).toBe("noop");
  });
});

// ─── Contact ────────────────────────────────────────────────────────────────

describe("resolveMatchAction — contact con tag cliente → cerrado", () => {
  it("sin lead → create source='ghl', status='cerrado', pinned", () => {
    const action = resolveMatchAction({
      eventKind: "contact",
      existing: null,
      hasClientTag: true,
      ...BASE_ARGS,
    });
    expect(action.kind).toBe("create");
    if (action.kind !== "create") return;
    expect(action.payload.source).toBe("ghl");
    expect(action.payload.status).toBe("cerrado");
    expect(action.payload.pinned_to_kanban).toBe(true);
  });

  it("lead tibio existente → cerrado + pin", () => {
    const action = resolveMatchAction({
      eventKind: "contact",
      existing: existing({ status: "tibio" }),
      hasClientTag: true,
      ...BASE_ARGS,
    });
    expect(action.kind).toBe("update");
    if (action.kind !== "update") return;
    expect(action.patch.status).toBe("cerrado");
    expect(action.patch.pinned_to_kanban).toBe(true);
  });

  it("lead cerrado existente → noop (ya está en estado final)", () => {
    const action = resolveMatchAction({
      eventKind: "contact",
      existing: existing({ status: "cerrado" }),
      hasClientTag: true,
      ...BASE_ARGS,
    });
    expect(action.kind).toBe("noop");
  });
});

describe("resolveMatchAction — contact sin tag cliente (formulario sin actividad)", () => {
  it("sin lead → create source='ghl', status='frio', NO pinned", () => {
    const action = resolveMatchAction({
      eventKind: "contact",
      existing: null,
      hasClientTag: false,
      ...BASE_ARGS,
    });
    expect(action.kind).toBe("create");
    if (action.kind !== "create") return;
    expect(action.payload.source).toBe("ghl");
    expect(action.payload.status).toBe("frio");
    expect(action.payload.pinned_to_kanban).toBe(false);
  });

  it("lead existente → noop (no toca; el sync de WA/appointments se encarga)", () => {
    const action = resolveMatchAction({
      eventKind: "contact",
      existing: existing({ status: "tibio" }),
      hasClientTag: false,
      ...BASE_ARGS,
    });
    expect(action.kind).toBe("noop");
  });
});
