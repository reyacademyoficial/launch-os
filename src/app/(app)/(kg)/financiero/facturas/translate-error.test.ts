import { describe, expect, it } from "vitest";

import { translateInvoiceError } from "./translate-error";

describe("translateInvoiceError", () => {
  it("23514 con invoices_tax_within_gross → mensaje explícito de IVA", () => {
    const out = translateInvoiceError({
      code: "23514",
      message:
        'new row for relation "invoices" violates check constraint "invoices_tax_within_gross"',
    });
    expect(out).toContain("IVA");
    expect(out).toContain("bruto");
  });

  it("23514 con invoices_paid_at_matches_status → dice inconsistencia estado/fecha", () => {
    const out = translateInvoiceError({
      code: "23514",
      message:
        'violates check constraint "invoices_paid_at_matches_status"',
    });
    expect(out).toContain("Estado");
    expect(out).toContain("cobrada");
  });

  it("23503 sobre project_id → dice recargar", () => {
    const out = translateInvoiceError({
      code: "23503",
      message: 'foreign key constraint "invoices_project_id_fkey"',
    });
    expect(out).toContain("proyecto");
    expect(out).toContain("Recargá");
  });

  it("23505 sobre invoices_installment_uniq → sugiere regenerar", () => {
    const out = translateInvoiceError({
      code: "23505",
      message:
        'duplicate key value violates unique constraint "invoices_installment_uniq"',
    });
    expect(out).toContain("cuota");
    expect(out).toContain("Regenerá");
  });

  it("23505 sobre invoices_org_number_uniq → dice número duplicado", () => {
    const out = translateInvoiceError({
      code: "23505",
      message:
        'duplicate key value violates unique constraint "invoices_org_number_uniq"',
    });
    expect(out).toContain("número");
  });

  it("código desconocido → propaga mensaje original", () => {
    const out = translateInvoiceError({
      code: "42P01",
      message: 'relation "foo" does not exist',
    });
    expect(out).toContain("does not exist");
  });

  it("sin código ni mensaje → fallback genérico", () => {
    const out = translateInvoiceError({});
    expect(out).toContain("Error");
  });
});
