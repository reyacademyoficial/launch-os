import { describe, expect, it } from "vitest";

import { pickCurrentOrganizationId } from "./current";

describe("pickCurrentOrganizationId", () => {
  it("una sola org visible → devuelve su id (caso hoy)", () => {
    expect(
      pickCurrentOrganizationId([{ id: "kingrow-uuid" }]),
    ).toBe("kingrow-uuid");
  });

  it("cero orgs visibles → null (caller lo traduce a 'sin permisos')", () => {
    expect(pickCurrentOrganizationId([])).toBeNull();
  });

  it("dos o más orgs visibles → THROW (guardarraíl multi-org)", () => {
    // El caso peligroso: cuando multi-org esté vivo, elegir "la primera" en
    // silencio significaría que una persona o una regla se cargue en la org
    // equivocada. En escrituras económicas eso no vale un default silencioso.
    expect(() =>
      pickCurrentOrganizationId([{ id: "org-A" }, { id: "org-B" }]),
    ).toThrow(/selector/);
  });

  it("tres orgs también hace throw (guardarraíl no es 'solo si son exactamente 2')", () => {
    expect(() =>
      pickCurrentOrganizationId([
        { id: "a" },
        { id: "b" },
        { id: "c" },
      ]),
    ).toThrow();
  });
});
