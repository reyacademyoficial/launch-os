import { describe, expect, it } from "vitest";

import { extractCountryIso2, type GhlOpportunity } from "./ghl";
import type { ExistingLeadView } from "./ghl-match";
import {
  normalize,
  resolveTeamMemberAssignment,
  selectBestOppByContact,
} from "./sync-ghl";

/**
 * Regla "manual gana sobre API" para `team_member_id`. La auditoría de Fase B
 * marcó un bug donde el sync de GHL pisaba la asignación manual del usuario
 * cada vez que GHL devolvía `assignedTo` (con o sin mapping). El helper
 * `resolveTeamMemberAssignment` centraliza la regla:
 *
 *   - existing con team_member_id ya seteado → undefined (no tocar).
 *   - existing vacío + API sin valor (null/undefined) → undefined (nunca null).
 *   - existing vacío + API con valor mapeado → ese valor.
 */

const existingWithManual: ExistingLeadView = {
  id: "lead-A",
  status: "tibio",
  pinned_to_kanban: true,
  external_id: "ghl-1",
  source: "ghl",
  phone_normalized: "+5491100000000",
  team_member_id: "manual-X",
};

const existingEmpty: ExistingLeadView = {
  id: "lead-B",
  status: "tibio",
  pinned_to_kanban: true,
  external_id: "ghl-2",
  source: "ghl",
  phone_normalized: "+5491100000001",
  team_member_id: null,
};

describe("resolveTeamMemberAssignment", () => {
  it("manual existente + API trae mapeo distinto → undefined (no pisa)", () => {
    expect(resolveTeamMemberAssignment(existingWithManual, "api-Y")).toBeUndefined();
  });

  it("manual existente + API sin mapeo (null) → undefined (no borra a null)", () => {
    expect(resolveTeamMemberAssignment(existingWithManual, null)).toBeUndefined();
  });

  it("manual existente + API no trae assignedTo (undefined) → undefined", () => {
    expect(resolveTeamMemberAssignment(existingWithManual, undefined)).toBeUndefined();
  });

  it("existing vacío + API trae mapeo → setea ese valor", () => {
    expect(resolveTeamMemberAssignment(existingEmpty, "api-Y")).toBe("api-Y");
  });

  it("existing vacío + API sin mapeo (null) → undefined (no escribe null)", () => {
    expect(resolveTeamMemberAssignment(existingEmpty, null)).toBeUndefined();
  });

  it("lead nuevo (existing null) + API trae mapeo → setea ese valor", () => {
    expect(resolveTeamMemberAssignment(null, "api-Y")).toBe("api-Y");
  });

  it("lead nuevo + API sin mapeo → undefined (createPayload lo resuelve a null)", () => {
    expect(resolveTeamMemberAssignment(null, null)).toBeUndefined();
    expect(resolveTeamMemberAssignment(null, undefined)).toBeUndefined();
  });

  it("trata string vacío del existing como sin asignación (cae a la rama de API)", () => {
    // Defensa: si en DB el team_member_id quedó como "" en vez de null, no
    // queremos que eso bloquee la asignación de la API. `""` es falsy.
    const withEmptyString: ExistingLeadView = {
      ...existingEmpty,
      team_member_id: "",
    };
    expect(resolveTeamMemberAssignment(withEmptyString, "api-Y")).toBe("api-Y");
  });
});

describe("extractCountryIso2", () => {
  // Fase B Bug 1: validamos que el `country` de GHL sea ISO-2 antes de
  // pasárselo a libphonenumber. Cualquier shape raro → null para que el
  // sync caiga al fallback E.164-only sin asumir país.
  it("acepta 'AR' tal cual", () => {
    expect(extractCountryIso2({ country: "AR" })).toBe("AR");
  });
  it("uppercase + trim de 'ar  ' → 'AR'", () => {
    expect(extractCountryIso2({ country: "ar  " })).toBe("AR");
  });
  it("rechaza ISO-3 'ARG'", () => {
    expect(extractCountryIso2({ country: "ARG" })).toBeNull();
  });
  it("rechaza nombre 'Argentina'", () => {
    expect(extractCountryIso2({ country: "Argentina" })).toBeNull();
  });
  it("null/undefined/string vacío → null", () => {
    expect(extractCountryIso2({ country: null })).toBeNull();
    expect(extractCountryIso2({ country: undefined })).toBeNull();
    expect(extractCountryIso2({ country: "" })).toBeNull();
    expect(extractCountryIso2({})).toBeNull();
  });
  it("dígitos o símbolos → null", () => {
    expect(extractCountryIso2({ country: "12" })).toBeNull();
    expect(extractCountryIso2({ country: "A1" })).toBeNull();
  });
});

describe("normalize (phone → E.164)", () => {
  // Política Fase B Bug 1: sin country, no asumimos AR. Solo aceptamos
  // strings que libphonenumber puede parsear sin region default — en la
  // práctica eso significa E.164 con "+".

  it("E.164 completo sin country → mantiene el E.164", () => {
    expect(normalize("+5491112345678", undefined)).toBe("+5491112345678");
  });

  it('E.164 completo con country distinto → respeta el "+" prefix', () => {
    // El "+" prefix gana sobre el country default — es lo que da E.164 sin
    // tener que asumir nada.
    expect(normalize("+5491112345678", "MX")).toBe("+5491112345678");
  });

  it("local sin country → null (no asumir país)", () => {
    expect(normalize("11 1234-5678", undefined)).toBeNull();
  });

  it("local con country AR → E.164 AR", () => {
    const got = normalize("11 1234-5678", "AR");
    expect(got).not.toBeNull();
    expect(got!.startsWith("+54")).toBe(true);
  });

  it("local con country MX → E.164 MX (no AR)", () => {
    // Acá está el bug original: con "11 1234-5678" + country hardcoded "AR"
    // libphonenumber producía un E.164 AR equivocado para un contact MX.
    // Con el fix, el adapter pasa "MX" por-contact y el resultado es MX.
    const got = normalize("55 1234 5678", "MX");
    expect(got).not.toBeNull();
    expect(got!.startsWith("+52")).toBe(true);
  });

  it("null/vacío → null", () => {
    expect(normalize(null, "AR")).toBeNull();
    expect(normalize("", "AR")).toBeNull();
    expect(normalize("   ", "AR")).toBeNull();
  });

  it("no parseable → null", () => {
    expect(normalize("not-a-phone", undefined)).toBeNull();
    expect(normalize("not-a-phone", "AR")).toBeNull();
  });

  it("E.164 sin '+' (solo dígitos) sin country → null", () => {
    // Sin el "+", libphonenumber no puede distinguir un número internacional
    // de un local. Es justamente lo que el bug original confundía.
    expect(normalize("5491112345678", undefined)).toBeNull();
  });
});

describe("selectBestOppByContact", () => {
  function makeOpp(over: Partial<GhlOpportunity>): GhlOpportunity {
    return {
      id: "opp-" + Math.random().toString(36).slice(2, 8),
      contactId: null,
      pipelineId: null,
      pipelineStageId: null,
      status: "open",
      monetaryValue: null,
      source: null,
      assignedTo: null,
      wonAt: null,
      createdAt: null,
      updatedAt: null,
      raw: {},
      ...over,
    };
  }

  it("descarta opps sin contactId", () => {
    const map = selectBestOppByContact([
      makeOpp({ contactId: null, assignedTo: "ghl-1" }),
    ]);
    expect(map.size).toBe(0);
  });

  it("descarta opps sin assignedTo", () => {
    const map = selectBestOppByContact([
      makeOpp({ contactId: "c-1", assignedTo: null }),
    ]);
    expect(map.size).toBe(0);
  });

  it("una opp por contact con assignedTo → la incluye", () => {
    const opp = makeOpp({ contactId: "c-1", assignedTo: "ghl-1" });
    const map = selectBestOppByContact([opp]);
    expect(map.get("c-1")).toBe(opp);
  });

  it("varias opps del mismo contact → gana la más reciente por updatedAt", () => {
    const older = makeOpp({
      contactId: "c-1",
      assignedTo: "ghl-A",
      updatedAt: "2026-06-20T10:00:00Z",
    });
    const newer = makeOpp({
      contactId: "c-1",
      assignedTo: "ghl-B",
      updatedAt: "2026-06-24T10:00:00Z",
    });
    const map = selectBestOppByContact([older, newer]);
    expect(map.get("c-1")).toBe(newer);
    expect(map.get("c-1")!.assignedTo).toBe("ghl-B");
  });

  it("orden de entrada no afecta — la más reciente gana siempre", () => {
    const older = makeOpp({
      contactId: "c-1",
      assignedTo: "ghl-A",
      updatedAt: "2026-06-20T10:00:00Z",
    });
    const newer = makeOpp({
      contactId: "c-1",
      assignedTo: "ghl-B",
      updatedAt: "2026-06-24T10:00:00Z",
    });
    expect(selectBestOppByContact([older, newer]).get("c-1")).toBe(newer);
    expect(selectBestOppByContact([newer, older]).get("c-1")).toBe(newer);
  });

  it("opps de varios contacts → mapa con una entry por contact", () => {
    const opps: GhlOpportunity[] = [
      makeOpp({ contactId: "c-1", assignedTo: "ghl-A" }),
      makeOpp({ contactId: "c-2", assignedTo: "ghl-B" }),
      makeOpp({ contactId: "c-3", assignedTo: "ghl-A" }),
    ];
    const map = selectBestOppByContact(opps);
    expect(map.size).toBe(3);
    expect(map.get("c-1")!.assignedTo).toBe("ghl-A");
    expect(map.get("c-2")!.assignedTo).toBe("ghl-B");
    expect(map.get("c-3")!.assignedTo).toBe("ghl-A");
  });

  it("opp sin updatedAt no pisa una con updatedAt válido (defensa)", () => {
    const withDate = makeOpp({
      contactId: "c-1",
      assignedTo: "ghl-A",
      updatedAt: "2026-06-24T10:00:00Z",
    });
    const noDate = makeOpp({
      contactId: "c-1",
      assignedTo: "ghl-B",
      updatedAt: null,
    });
    // Llega primero la que SÍ tiene fecha; la siguiente no tiene → no debe pisar.
    expect(selectBestOppByContact([withDate, noDate]).get("c-1")).toBe(withDate);
  });
});
