import { safeDiv, safeNumber, safePercent } from "@/lib/kpis";

/**
 * Reverse planning: "How do I need to spend / who do I need to reach to hit
 * a given revenue goal?" Ported verbatim from the prototype's CalcPage.
 *
 * Input values are kept as strings in the form state so partial typing
 * ("1.") doesn't lose the typed dot. The math layer coerces via safeNumber.
 */
export interface ReverseInput {
  revenueGoal: string;
  ticket: string;
  roasTarget: string;
  asistClase1: string; // %
  asistOferta: string; // % (of clase 1)
  convOfertaApp: string; // %
  convAppVenta: string; // %
  cpl: string;
  costoEquipo: string;
  costoOp: string;
  comisiones: string;
}

export interface FunnelStep {
  label: string;
  value: number;
  color: string;
}

export interface ReverseOutput {
  ventas: number;
  apps: number;
  asistOferta: number;
  asistClase1: number;
  leads: number;
  invMax: number;
  budget: number;
  totalCosts: number;
  profit: number;
  margen: number; // %
  roasProy: number;
  beRoas: number; // break-even ROAS
  cplMax: number;
  cpaMax: number;
  funnel: readonly FunnelStep[];
}

export const REVERSE_DEFAULTS: ReverseInput = {
  revenueGoal: "100000",
  ticket: "2000",
  roasTarget: "4",
  asistClase1: "55",
  asistOferta: "60",
  convOfertaApp: "25",
  convAppVenta: "20",
  cpl: "3.50",
  costoEquipo: "",
  costoOp: "",
  comisiones: "",
};

// Funnel colors — kept hex to match the prototype exactly.
const COLORS = {
  leads: "#A1A1AA", // fg-muted-ish
  clase1: "#FFB800", // brand warning
  oferta: "#00D084", // brand success
  apps: "#38BDF8", // sky
  ventas: "#FF006E", // brand accent
};

export function calculateReverse(raw: ReverseInput): ReverseOutput {
  const revenueGoal = safeNumber(raw.revenueGoal);
  const ticket = safeNumber(raw.ticket);
  const roasTarget = safeNumber(raw.roasTarget);
  const asistClase1Pct = safeNumber(raw.asistClase1);
  const asistOfertaPct = safeNumber(raw.asistOferta);
  const convOfertaAppPct = safeNumber(raw.convOfertaApp);
  const convAppVentaPct = safeNumber(raw.convAppVenta);
  const cpl = safeNumber(raw.cpl);
  const costoEquipo = safeNumber(raw.costoEquipo);
  const costoOp = safeNumber(raw.costoOp);
  const comisiones = safeNumber(raw.comisiones);

  // Funnel walked backwards from the revenue goal.
  const ventas = Math.ceil(safeDiv(revenueGoal, ticket));
  const apps = Math.ceil(safeDiv(ventas, convAppVentaPct / 100));
  const asistOferta = Math.ceil(safeDiv(apps, convOfertaAppPct / 100));
  const asistClase1 = Math.ceil(safeDiv(asistOferta, asistOfertaPct / 100));
  const leads = Math.ceil(safeDiv(asistClase1, asistClase1Pct / 100));

  const invMax = safeDiv(revenueGoal, roasTarget);
  const budget = leads * cpl;
  const totalCosts = budget + costoEquipo + costoOp + comisiones;
  const profit = revenueGoal - totalCosts;
  const margen = safePercent(profit, revenueGoal);
  const roasProy = safeDiv(revenueGoal, budget);
  const beRoas = safeDiv(totalCosts, budget);
  const cplMax = safeDiv(invMax, leads);
  const cpaMax = safeDiv(invMax, ventas);

  return {
    ventas,
    apps,
    asistOferta,
    asistClase1,
    leads,
    invMax,
    budget,
    totalCosts,
    profit,
    margen,
    roasProy,
    beRoas,
    cplMax,
    cpaMax,
    funnel: [
      { label: "Leads", value: leads, color: COLORS.leads },
      { label: "Clase 1", value: asistClase1, color: COLORS.clase1 },
      { label: "Oferta", value: asistOferta, color: COLORS.oferta },
      { label: "Apps", value: apps, color: COLORS.apps },
      { label: "Ventas", value: ventas, color: COLORS.ventas },
    ],
  };
}
