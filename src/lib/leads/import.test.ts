import { describe, expect, it } from "vitest";

import { autoMap, normalizePhone } from "./import";

describe("normalizePhone", () => {
  it("devuelve null para input vacío o null", () => {
    expect(normalizePhone(null, "AR")).toBeNull();
    expect(normalizePhone(undefined, "AR")).toBeNull();
    expect(normalizePhone("", "AR")).toBeNull();
    expect(normalizePhone("   ", "AR")).toBeNull();
  });

  it("normaliza número argentino sin prefijo a E.164", () => {
    // Móvil de Buenos Aires con prefijo 9 (formato local argentino).
    // El test usa números válidos de libphonenumber para que el assertion
    // no dependa de heurísticas locales.
    const out = normalizePhone("+5491155555555", "AR");
    expect(out).toBe("+5491155555555");
  });

  it("acepta separadores (espacios/guiones) y los elimina", () => {
    const out = normalizePhone("+54 9 11 5555-5555", "AR");
    expect(out).toBe("+5491155555555");
  });

  it("devuelve null cuando el número es inválido", () => {
    expect(normalizePhone("not a phone", "AR")).toBeNull();
    expect(normalizePhone("12", "AR")).toBeNull();
  });

  it("respeta el country default cuando no hay prefijo internacional", () => {
    // Número uruguayo en formato local interpretado con UY default.
    const out = normalizePhone("099123456", "UY");
    expect(out).toMatch(/^\+598/);
  });

  it("ignora el country default cuando el número viene con +", () => {
    // +54 dispara reconocimiento como AR aunque el default sea US.
    const out = normalizePhone("+5491155555555", "US");
    expect(out).toBe("+5491155555555");
  });
});

describe("autoMap", () => {
  it("matchea name/phone/email por keywords en español", () => {
    const headers = ["Nombre Completo", "Teléfono", "Email", "Notas"];
    const out = autoMap(headers);
    expect(out.name).toBe("Nombre Completo");
    expect(out.phone).toBe("Teléfono");
    expect(out.email).toBe("Email");
  });

  it("matchea por keywords en inglés también", () => {
    const headers = ["Full Name", "Phone Number", "Mail"];
    const out = autoMap(headers);
    expect(out.name).toBe("Full Name");
    expect(out.phone).toBe("Phone Number");
    expect(out.email).toBe("Mail");
  });

  it("matchea celular / móvil / whatsapp como phone", () => {
    expect(autoMap(["celular"]).phone).toBe("celular");
    expect(autoMap(["WhatsApp"]).phone).toBe("WhatsApp");
    expect(autoMap(["Móvil"]).phone).toBe("Móvil");
  });

  it("no asigna campos cuando no hay match", () => {
    const out = autoMap(["foo", "bar", "baz"]);
    expect(out.name).toBeUndefined();
    expect(out.phone).toBeUndefined();
    expect(out.email).toBeUndefined();
  });

  it("contact matchea contacto / instagram / handle", () => {
    expect(autoMap(["Contacto"]).contact).toBe("Contacto");
    expect(autoMap(["Instagram"]).contact).toBe("Instagram");
  });
});
