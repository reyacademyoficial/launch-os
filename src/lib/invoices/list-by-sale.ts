import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Shape mínimo para el dropdown "Aplicar a factura" del form de cobros.
 * Un subset de `invoices` — no reusamos FinanceInvoiceRow porque el modal es
 * client-side y no queremos arrastrar tipos server-only.
 */
export interface InvoiceForPaymentForm {
  readonly id: string;
  readonly sale_id: string | null;
  readonly invoice_number: string | null;
  readonly installment_id: string | null;
  readonly amount_gross: number;
  readonly status: string;
}

/**
 * Trae las facturas emitidas de un conjunto de ventas — usada por el modal de
 * cobros para auto-seleccionar la factura correspondiente a la cuota elegida.
 * Filtra a status='emitida' (las cobradas y anuladas no son atajables por un
 * cobro nuevo).
 */
export async function listInvoicesForSales(
  saleIds: ReadonlyArray<string>,
): Promise<InvoiceForPaymentForm[]> {
  if (saleIds.length === 0) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("invoices")
    .select(
      "id, sale_id, invoice_number, installment_id, amount_gross, status",
    )
    .in("sale_id", saleIds as string[])
    .eq("status", "emitida");

  return (data ?? []) as unknown as InvoiceForPaymentForm[];
}
