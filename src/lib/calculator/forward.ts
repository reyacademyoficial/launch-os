import { safeDiv, safeNumber } from "@/lib/kpis";

/**
 * Forward planning: "Given a budget, what do I get?" Ported verbatim from
 * the prototype's CalcPage forward branch.
 */
export interface ForwardInput {
  adBudget: string;
  cpl: string;
  showUp: string; // %
  closeRate: string; // %
  ticket: string;
}

export interface ForwardOutput {
  leads: number;
  asistentes: number;
  ventas: number;
  revenue: number;
  profit: number;
  roas: number;
}

export const FORWARD_DEFAULTS: ForwardInput = {
  adBudget: "5000",
  cpl: "3",
  showUp: "40",
  closeRate: "10",
  ticket: "997",
};

export function calculateForward(raw: ForwardInput): ForwardOutput {
  const adBudget = safeNumber(raw.adBudget);
  const cpl = safeNumber(raw.cpl);
  const showUp = safeNumber(raw.showUp);
  const closeRate = safeNumber(raw.closeRate);
  const ticket = safeNumber(raw.ticket);

  const leads = cpl > 0 ? Math.floor(safeDiv(adBudget, cpl)) : 0;
  const asistentes = Math.floor((leads * showUp) / 100);
  const ventas = Math.floor((asistentes * closeRate) / 100);
  const revenue = ventas * ticket;
  const profit = revenue - adBudget;
  const roas = safeDiv(revenue, adBudget);

  return { leads, asistentes, ventas, revenue, profit, roas };
}
