/**
 * Etapas del lanzamiento con presupuesto asignable. Espejan las etapas del
 * calendario (`lib/launches/calendar.ts`) MENOS `compra` y `cierre`, que no
 * llevan presupuesto de tráfico. El CHECK del DB (mig 0048) es la fuente de
 * verdad — si sumás una etapa acá, actualizá también el CHECK.
 */
export const BUDGET_STAGES = [
  "creacion",
  "nutricion",
  "captacion",
  "calentamiento",
  "consumo",
] as const;
export type BudgetStage = (typeof BUDGET_STAGES)[number];

export const BUDGET_STAGE_LABELS: Record<BudgetStage, string> = {
  creacion: "Creación",
  nutricion: "Nutrición",
  captacion: "Captación",
  calentamiento: "Calentamiento",
  consumo: "Consumo",
};

/**
 * Monedas sugeridas en el selector inicial. No es exhaustivo — el DB acepta
 * cualquier código ISO-4217 de 3 letras mayúsculas.
 */
export const COMMON_CURRENCIES = [
  "USD",
  "EUR",
  "ARS",
  "MXN",
  "COP",
  "CLP",
  "PEN",
  "BRL",
  "UYU",
] as const;

export interface BudgetCountryRow {
  id: string;
  project_id: string;
  name: string;
  created_by: string | null;
  created_at: string;
}

export interface BudgetEntryRow {
  id: string;
  launch_id: string;
  stage: BudgetStage;
  country_id: string;
  amount: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
