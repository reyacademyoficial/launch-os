import { NextResponse } from "next/server";

import {
  renderInvoiceRemitoPdf,
  type InvoiceRemitoInput,
} from "@/lib/reports/invoice-remito-pdf";
import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/facturas/[id]/pdf
 *
 * Emite el "Remito de venta" en PDF para enviar al comprador. Externamente
 * el documento NO usa la palabra "factura" (regla de Finanzas: los remitos
 * son documentos no-fiscales que confirman la venta); internamente sí lo
 * modelamos como fila de `invoices`.
 *
 * Permisos: superadmin. El PDF muestra datos del comprador y montos —
 * mismo criterio que las otras rutas de reporte del módulo Financiero.
 *
 * RLS: la query con `.eq("id", ...).maybeSingle()` responde null si el
 * usuario no ve la factura por RLS (org-scope). Devolvemos 404 en ese caso.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await requireRole("superadmin");

  const supabase = await createClient();

  // Fetch principal — todos los campos que necesita el PDF.
  const invRes = await supabase
    .from("invoices")
    .select(
      "id, invoice_number, status, issue_date, due_date, purchase_date, payment_date, currency, amount_gross, tax_amount, buyer_name, buyer_email, buyer_document, transaction_number, notes, organization_id, product_id, description",
    )
    .eq("id", id)
    .maybeSingle();

  if (invRes.error) {
    return NextResponse.json({ error: invRes.error.message }, { status: 500 });
  }
  const inv = invRes.data as
    | {
        id: string;
        invoice_number: string | null;
        status: "emitida" | "cobrada" | "vencida" | "anulada";
        issue_date: string;
        due_date: string | null;
        purchase_date: string | null;
        payment_date: string | null;
        currency: string | null;
        amount_gross: number;
        tax_amount: number;
        buyer_name: string | null;
        buyer_email: string | null;
        buyer_document: string | null;
        transaction_number: string | null;
        notes: string | null;
        organization_id: string;
        product_id: string | null;
        description: string;
      }
    | null;
  if (!inv) {
    return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
  }

  // Resolver vendedor (organización) y producto en paralelo.
  const [orgRes, productRes] = await Promise.all([
    supabase
      .from("organization")
      .select("name")
      .eq("id", inv.organization_id)
      .maybeSingle(),
    inv.product_id
      ? supabase
          .from("products")
          .select("name, description")
          .eq("id", inv.product_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const org = orgRes.data as { name: string } | null;
  const product = productRes.data as
    | { name: string; description: string | null }
    | null;

  const input: InvoiceRemitoInput = {
    invoiceNumber: inv.invoice_number ?? "—",
    status: inv.status,
    issueDate: inv.issue_date,
    dueDate: inv.due_date,
    purchaseDate: inv.purchase_date,
    paymentDate: inv.payment_date,
    currency: inv.currency ?? "ARS",
    amountGross: Number(inv.amount_gross),
    taxAmount: Number(inv.tax_amount),
    buyer: {
      name: inv.buyer_name,
      email: inv.buyer_email,
      document: inv.buyer_document,
    },
    seller: {
      // La tabla `organization` sólo tiene `name` hoy. Si más adelante se
      // agrega business_name / tax_id, exponerlos acá.
      name: org?.name ?? "—",
      businessName: null,
      document: null,
    },
    product: {
      // Fallback a la descripción de la factura si no hay producto atado
      // (facturas fee-a-cliente-externo típicamente).
      name: product?.name ?? inv.description,
      description: product?.description ?? null,
    },
    transactionNumber: inv.transaction_number,
    notes: inv.notes,
  };

  let buffer: Buffer;
  try {
    buffer = await renderInvoiceRemitoPdf(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : "render_failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const filename = `remito-${input.invoiceNumber}.pdf`;
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
