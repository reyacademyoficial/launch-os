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
  // Los tres casos de la tabla del brief ────────────────────────────────

  it("con launch_id → group-volume (aunque el proyecto sea propio)", () => {
    // Regla: si está ligada a un lanzamiento, la plata ya la contó la
    // liquidación. El ownership es irrelevante para esta rama.
    expect(
      classifyInvoice(
        invoice({ project_id: "proj-A", launch_id: "launch-1" }),
        "propia",
      ),
    ).toBe("group-volume");

    expect(
      classifyInvoice(
        invoice({ project_id: "proj-B", launch_id: "launch-2" }),
        "externa",
      ),
    ).toBe("group-volume");
  });

  it("sin launch_id + proyecto propio → kingrow-income", () => {
    // Venta suelta / retainer de una empresa propia (Rey Academy, Growins).
    // Ninguna liquidación la captura → es ingreso real de Kingrow.
    expect(
      classifyInvoice(
        invoice({ project_id: "proj-rey", launch_id: null }),
        "propia",
      ),
    ).toBe("kingrow-income");
  });

  it("sin launch_id + proyecto externo → third-party", () => {
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
