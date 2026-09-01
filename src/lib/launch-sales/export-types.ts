/**
 * Contrato del export de Ventas, compartido entre el cliente (que arma las
 * filas visibles) y el server (que las serializa a xlsx).
 *
 * Vive aparte de `export.ts` porque ese módulo es `server-only` — el botón
 * cliente necesita los tipos, no el builder.
 */

export type ExportCurrency = "ARS" | "USD";

export type ExportCollectionStatus = "paid" | "partial" | "unpaid";

export interface SaleExportRow {
  readonly student: string;
  /** `leads.email` estructurado; "" cuando no hay. Solo lo cargan los leads
   * que entran por el módulo Leads (import, Meta, GHL, alta manual). */
  readonly email: string;
  /** `leads.phone_normalized`; "" cuando no hay. Misma procedencia que email. */
  readonly phone: string;
  /**
   * `leads.contact` — texto libre "email o teléfono". Es el ÚNICO dato de
   * contacto que guarda el modal de alta de venta, así que para las ventas
   * cargadas desde Ventas es la única columna que va a tener algo.
   */
  readonly contact: string;
  readonly product: string;
  readonly launch: string;
  readonly seller: string;
  readonly method: string;
  readonly currency: ExportCurrency;
  readonly pledged: number;
  readonly collected: number;
  readonly collectedCurrency: ExportCurrency;
  /** true cuando los cobros están en moneda distinta al pactado. */
  readonly mixedCurrency: boolean;
  readonly commission: number;
  readonly commissionCurrency: ExportCurrency;
  readonly status: ExportCollectionStatus;
  /** `null` cuando falta tasa FX para convertir. */
  readonly pledgedUsd: number | null;
  readonly collectedUsd: number | null;
  readonly paymentCount: number;
  readonly installmentCount: number;
  /** ISO timestamptz de `sales.closed_at`. */
  readonly closedAt: string;
}

export interface SalesExportMeta {
  readonly projectName?: string;
  /** Descripción legible de los filtros activos. Vacío = sin filtros. */
  readonly filters: ReadonlyArray<string>;
  /** Oculta las columnas de comisión (rol `closer`). */
  readonly hideCommission: boolean;
}
