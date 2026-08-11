import { describe, expect, it } from "vitest";

import { classifyInvoice, type Ownership } from "./invoice-classification";
import type { FinanceInvoiceRow } from "./types";

function invoice(
  overrides: Partial<Pick<FinanceInvoiceRow, "project_id" | "launch_id">>,
): Pick<FinanceInvoiceRow, "project_id" | "launch_id"> {
  return {
    project_id: null,
    launch_id: null,
    ...overrides,
  };
}

describe("classifyInvoice", () => {
  // Regla actual: propia siempre es kingrow-income; group-volume queda solo
  // para launches externos (contexto), y third-party para ventas sueltas
  // externas o defectos de carga.

  it("propia con launch_id → kingrow-income (percibido, sin esperar liquidación)", () => {
    // Cambio de regla: administración quiere ver la plata cobrada de las
    // propias en el día a día. La liquidación de propias no debe volver a
    // sumar — la enforce está en el caller filtrando settlements.
    expect(
      classifyInvoice(
        invoice({ project_id: "proj-rey", launch_id: "launch-1" }),
        "propia",
      ),
    ).toBe("kingrow-income");
  });

  it("externa con launch_id → group-volume (ingreso llega al liquidar)", () => {
    // Externa sigue con la regla vieja: la factura del launch es plata del
    // cliente externo, no de Kingrow. El ingreso propio se reconoce al
    // cerrar la liquidación (kingrow_retained).
    expect(
      classifyInvoice(
        invoice({ project_id: "proj-B", launch_id: "launch-2" }),
        "externa",
      ),
    ).toBe("group-volume");
  });

  it("propia sin launch_id → kingrow-income", () => {
    // Venta suelta / retainer de una empresa propia (Rey Academy, Growins).
    expect(
      classifyInvoice(
        invoice({ project_id: "proj-rey", launch_id: null }),
        "propia",
      ),
    ).toBe("kingrow-income");
  });

  it("externa sin launch_id → third-party", () => {
    // Venta suelta de un cliente externo (Maestro Charcutero,
    // Super Instructor Marcos). Visible pero no es plata de Kingrow.
    expect(
      classifyInvoice(
        invoice({ project_id: "proj-maestro", launch_id: null }),
        "externa",
      ),
    ).toBe("third-party");
  });

  // Bordes ──────────────────────────────────────────────────────────────

  it("sin project_id → third-party (defecto de carga, no ingreso)", () => {
    // Toda operativa es un proyecto; una factura sin project_id es un dato
    // incompleto. Se cae a third-party para que no contamine el ingreso.
    // El caller lo cuenta aparte en el indicador de calidad de dato.
    expect(
      classifyInvoice(
        invoice({ project_id: null, launch_id: null }),
        null,
      ),
    ).toBe("third-party");
  });

  it("ownership desconocido (proyecto no en el mapa) → third-party", () => {
    // Si el caller no pudo resolver el ownership (proyecto borrado, RLS,
    // race), asumimos externo por seguridad — nunca inflar el ingreso.
    const cases: Ownership[] = [null];
    for (const own of cases) {
      expect(
        classifyInvoice(
          invoice({ project_id: "proj-huerfano", launch_id: null }),
          own,
        ),
      ).toBe("third-party");
    }
  });
});
