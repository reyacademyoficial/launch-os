/**
 * Tipos org-level para el módulo financiero de Kingrow.
 *
 * SHAPES MANUALES en el borde (cast at the boundary), mismo estilo que
 * settlements/types y commissions/types. Estas interfaces son el CONTRATO
 * que los selectores puros de `kpis.ts` esperan — el caller (server action /
 * loader) es responsable de leer las rows con Supabase y castearlas antes
 * de pasarlas. Los selectores NUNCA tocan Supabase.
 *
 * Solo se declaran los campos que los selectores realmente leen; el resto
 * de la fila se ignora (los objetos pueden traer más columnas, no molesta).
 * Cuando se regeneren los types con `supabase gen types`, van a quedar
 * como subset compatible de `Database["public"]["Tables"][X]["Row"]`.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Ingresos (revenue)
// ═══════════════════════════════════════════════════════════════════════════

export type LaunchSettlementStatus = "abierta" | "liquidada" | "transferida";

/**
 * Subset de `launch_settlements` que necesita el selector de ingresos.
 * Solo cuentan como ingreso realizado las de status ∈ {liquidada, transferida}.
 * `abierta` son borradores y NO deben computarse como revenue.
 */
export interface FinanceLaunchSettlementRow {
  kingrow_retained: number;
  status: LaunchSettlementStatus;
  closed_at: string | null;
  created_at: string;
}

export type InvoiceStatus = "emitida" | "cobrada" | "vencida" | "anulada";

/**
 * Subset de `invoices` (0064 + 0098). `project_id` identifica a la empresa
 * que emite (0064) — el ownership vive en `projects.ownership` y se resuelve
 * en el caller, no acá. `launch_id` (0098) distingue una factura de
 * lanzamiento (volumen del grupo) de una venta suelta; NULL = suelta.
 * amount_gross incluye IVA; el selector usa el NETO (gross - tax).
 *
 * La clasificación de una factura en `kingrow-income | group-volume |
 * third-party` NO vive en el shape — vive en `invoice-classification.ts`.
 * Cambiar la regla es UN solo lugar.
 */
export interface FinanceInvoiceRow {
  project_id: string | null;
  launch_id: string | null;
  amount_gross: number;
  tax_amount: number;
  currency: "ARS" | "USD";
  status: InvoiceStatus;
  paid_at: string | null;
  due_date: string | null;
  issue_date: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Egresos (expenses / payroll)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Subset de `expenses` (0063). `paid_at`=null → gasto devengado no pagado
 * (cuenta por pagar). `category` es texto libre — el caller decide la
 * clasificación en directo vs operativo (flag REVISAR CON CONTADOR).
 */
export interface FinanceExpenseRow {
  amount_gross: number;
  tax_amount: number;
  currency: "ARS" | "USD";
  category: string | null;
  paid_at: string | null;
  due_date: string | null;
  expense_date: string;
}

/**
 * Subset de `payroll` (0066). Sueldos fijos por período. Deducciones
 * negativas viven en `extras` (jsonb) pero total_amount ya las refleja —
 * el selector solo lee total_amount.
 */
export interface FinancePayrollRow {
  total_amount: number;
  currency: "ARS" | "USD";
  paid_at: string | null;
  due_date: string | null;
  period_start: string;
  period_end: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Cuenta corriente con externos (`client_transfers` 0056)
// ═══════════════════════════════════════════════════════════════════════════

export type ClientTransferDirection = "a_favor_cliente" | "transferido";

/**
 * Subset de `client_transfers`. Saldo = Σ a_favor_cliente − Σ transferido.
 * Si el saldo neto > 0, Kingrow le debe al cliente (pasivo corriente).
 */
export interface FinanceClientTransferRow {
  amount: number;
  direction: ClientTransferDirection;
  date: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Patrimonio (activos y pasivos)
// ═══════════════════════════════════════════════════════════════════════════

export interface FinanceAssetRow {
  amount: number;
  currency: "ARS" | "USD";
  active: boolean;
}

export interface FinanceLiabilityRow {
  amount: number;
  currency: "ARS" | "USD";
  active: boolean;
  settled_at: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Movimientos bancarios (`bank_movements` 0044/0057)
// ═══════════════════════════════════════════════════════════════════════════

export type BankMovementKind = "in" | "out";

/**
 * Subset de `bank_movements`. Cash flow = Σ 'in' − Σ 'out' del período.
 * NO incluye cobros de sales (esos viven en `payments`, no en bank_movements).
 */
export interface FinanceBankMovementRow {
  amount: number;
  kind: BankMovementKind;
  occurred_at: string;
}
