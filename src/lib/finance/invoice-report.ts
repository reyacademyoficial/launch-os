/**
 * Reporte de facturas — Paso 10.
 *
 * Consume el mismo shape que la vista /financiero/facturas y devuelve
 * totales por status + una lista detallada para tabla y export.
 *
 * REGLAS:
 *   - Status source of truth: `invoices.status`. Cuando el operador NO haya
 *     tocado la factura y su due_date < today, la clasificación efectiva es
 *     'vencida' aunque la DB diga 'emitida'. La consulta actual NO tiene
 *     cron que actualice ese status; lo reportamos derivado acá.
 *   - `gatewayFee` por factura = amount_gross − Σ(bridge role='principal'
 *     kind='in').amount. Se computa fuera y se pasa como `principalSumByInvoice`
 *     para que el selector siga siendo puro (no toca DB).
 *   - Consolidado por moneda: no sumamos ARS + USD como si fueran la misma
 *     unidad — mismo criterio que el reporte de bancos.
 */

export type InvoiceStatus = "emitida" | "cobrada" | "vencida" | "anulada";
export type EffectiveStatus = InvoiceStatus;

export interface InvoiceInput {
  readonly id: string;
  readonly status: InvoiceStatus;
  readonly issue_date: string;
  readonly due_date: string | null;
  readonly amount_gross: number;
  readonly currency: "ARS" | "USD" | string;
  readonly project_id: string | null;
  readonly invoice_number: string | null;
  readonly buyer_name: string | null;
  readonly description: string;
}

export interface InvoiceReportDetailRow {
  readonly id: string;
  readonly invoiceNumber: string | null;
  readonly issueDate: string;
  readonly dueDate: string | null;
  readonly status: EffectiveStatus;
  readonly currency: string;
  readonly amountGross: number;
  readonly gatewayFee: number | null;
  readonly projectId: string | null;
  readonly buyerName: string | null;
  readonly description: string;
}

export interface InvoiceReportBucket {
  readonly status: EffectiveStatus;
  readonly currency: string;
  readonly count: number;
  readonly amountGross: number;
  readonly gatewayFee: number;
}

export interface InvoiceReport {
  readonly detail: readonly InvoiceReportDetailRow[];
  readonly buckets: readonly InvoiceReportBucket[];
}

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  const n = parseFloat(v as string);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Deriva status efectivo: si la DB dice 'emitida' y due_date < todayYmd,
 * mostramos 'vencida'. Cobrada / anulada / vencida-en-DB pasan sin cambio.
 */
export function effectiveStatus(
  status: InvoiceStatus,
  dueDate: string | null,
  todayYmd: string,
): EffectiveStatus {
  if (status !== "emitida") return status;
  if (!dueDate) return "emitida";
  return dueDate.slice(0, 10) < todayYmd ? "vencida" : "emitida";
}

export function buildInvoiceReport(
  invoices: ReadonlyArray<InvoiceInput>,
  principalSumByInvoice: ReadonlyMap<string, number>,
  todayYmd: string,
): InvoiceReport {
  const detail: InvoiceReportDetailRow[] = [];
  const bucketMap = new Map<string, InvoiceReportBucket>();

  for (const i of invoices) {
    const gross = toNum(i.amount_gross);
    const principal = principalSumByInvoice.get(i.id);
    const gatewayFee =
      principal != null && principal > 0
        ? Math.max(gross - principal, 0)
        : null;
    const status = effectiveStatus(i.status, i.due_date, todayYmd);
    detail.push({
      id: i.id,
      invoiceNumber: i.invoice_number,
      issueDate: i.issue_date,
      dueDate: i.due_date,
      status,
      currency: i.currency,
      amountGross: gross,
      gatewayFee,
      projectId: i.project_id,
      buyerName: i.buyer_name,
      description: i.description,
    });

    const key = `${status}|${i.currency}`;
    const prev = bucketMap.get(key);
    if (prev) {
      bucketMap.set(key, {
        status,
        currency: i.currency,
        count: prev.count + 1,
        amountGross: prev.amountGross + gross,
        gatewayFee: prev.gatewayFee + (gatewayFee ?? 0),
      });
    } else {
      bucketMap.set(key, {
        status,
        currency: i.currency,
        count: 1,
        amountGross: gross,
        gatewayFee: gatewayFee ?? 0,
      });
    }
  }

  return {
    detail,
    buckets: Array.from(bucketMap.values()),
  };
}
