import type { BankMovementRow, BankRow } from "@/lib/banks/types";

/**
 * Reporte financiero de bancos — Paso 9.
 *
 * Contrato: para cada banco activo dentro del rango elegido, calcular
 * ingresos, egresos, neto y saldo cierre. Consolidado por moneda al final
 * (no sumamos ARS + USD como si fueran la misma unidad; el que integra los
 * dos totales en dashboard usa las tasas FX del proyecto).
 *
 * Contrato pensado para paso 9 (UI) y también export XLSX (paso 9 mismo).
 *
 * REGLAS:
 *   - `opening` viene del banco (opening_balance de la migración 0044).
 *   - `movementsIn` = Σ movimientos.kind='in'.
 *   - `movementsOut` = Σ movimientos.kind='out'.
 *   - `net` = movementsIn − movementsOut.
 *   - `closing` = opening + net.
 *   - `linkedIn` / `linkedOut` cuentan cuántos movimientos del banco están
 *     conciliados con factura (in) o gasto (out) — se pasan como
 *     `linkedMovementIds` (set precomputado por el caller).
 *
 * El selector es PURO: no toca DB. El caller trae banks + movements ya
 * filtrados por período y le pasa el set de ids linkeados si quiere el
 * cross-check de conciliación.
 */

export interface BankReportBucket {
  readonly bankId: string;
  readonly bankName: string;
  readonly currency: "ARS" | "USD";
  readonly opening: number;
  readonly movementsIn: number;
  readonly movementsOut: number;
  readonly net: number;
  readonly closing: number;
  readonly movementCount: number;
  readonly linkedCount: number;
  readonly unconciledCount: number;
}

export interface BankReportConsolidated {
  readonly currency: "ARS" | "USD";
  readonly opening: number;
  readonly movementsIn: number;
  readonly movementsOut: number;
  readonly net: number;
  readonly closing: number;
  readonly movementCount: number;
  readonly linkedCount: number;
}

export interface BankReport {
  readonly byBank: readonly BankReportBucket[];
  /** Sub-totales por moneda (ARS y USD si existen bancos de cada tipo). */
  readonly consolidated: readonly BankReportConsolidated[];
}

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  const n = parseFloat(v as string);
  return Number.isFinite(n) ? n : 0;
}

export function buildBankReport(
  banks: ReadonlyArray<BankRow>,
  movements: ReadonlyArray<
    Pick<BankMovementRow, "id" | "bank_id" | "kind" | "amount">
  >,
  linkedMovementIds: ReadonlySet<string> = new Set(),
): BankReport {
  // Inicializar buckets por banco (incluidos los sin movimientos en el rango).
  const bucketMap = new Map<string, {
    bank: BankRow;
    movementsIn: number;
    movementsOut: number;
    movementCount: number;
    linkedCount: number;
  }>();
  for (const b of banks) {
    bucketMap.set(b.id, {
      bank: b,
      movementsIn: 0,
      movementsOut: 0,
      movementCount: 0,
      linkedCount: 0,
    });
  }

  for (const m of movements) {
    const bucket = bucketMap.get(m.bank_id);
    if (!bucket) continue;
    const amt = toNum(m.amount);
    bucket.movementCount += 1;
    if (linkedMovementIds.has(m.id)) bucket.linkedCount += 1;
    if (m.kind === "in") bucket.movementsIn += amt;
    else bucket.movementsOut += amt;
  }

  const byBank: BankReportBucket[] = [];
  for (const bucket of bucketMap.values()) {
    const opening = toNum(bucket.bank.opening_balance);
    const net = bucket.movementsIn - bucket.movementsOut;
    byBank.push({
      bankId: bucket.bank.id,
      bankName: bucket.bank.name,
      currency: bucket.bank.currency,
      opening,
      movementsIn: bucket.movementsIn,
      movementsOut: bucket.movementsOut,
      net,
      closing: opening + net,
      movementCount: bucket.movementCount,
      linkedCount: bucket.linkedCount,
      unconciledCount: bucket.movementCount - bucket.linkedCount,
    });
  }

  // Consolidado por moneda.
  const consolidatedMap = new Map<"ARS" | "USD", BankReportConsolidated>();
  for (const b of byBank) {
    const prev = consolidatedMap.get(b.currency) ?? {
      currency: b.currency,
      opening: 0,
      movementsIn: 0,
      movementsOut: 0,
      net: 0,
      closing: 0,
      movementCount: 0,
      linkedCount: 0,
    };
    const next: BankReportConsolidated = {
      currency: b.currency,
      opening: prev.opening + b.opening,
      movementsIn: prev.movementsIn + b.movementsIn,
      movementsOut: prev.movementsOut + b.movementsOut,
      net: prev.net + b.net,
      closing: prev.closing + b.closing,
      movementCount: prev.movementCount + b.movementCount,
      linkedCount: prev.linkedCount + b.linkedCount,
    };
    consolidatedMap.set(b.currency, next);
  }

  return {
    byBank,
    consolidated: Array.from(consolidatedMap.values()),
  };
}
