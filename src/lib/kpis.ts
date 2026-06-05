/**
 * Pure KPI math, ported from the legacy prototype (`docs/legacy/App.jsx`).
 *
 * Input shape mirrors the DB `launches` row (snake_case) so rows from Supabase
 * can be passed in directly. Output is camelCase because it's read by UI code.
 *
 * All helpers are safe against NaN / Infinity / division-by-zero so partial
 * input never crashes the dashboard.
 */

export const safeNumber = (v: unknown, fallback = 0): number => {
  const n = typeof v === "number" ? v : parseFloat(v as string);
  return Number.isFinite(n) ? n : fallback;
};

export const safeInt = (v: unknown, fallback = 0): number => {
  const n = typeof v === "number" ? Math.trunc(v) : parseInt(v as string, 10);
  return Number.isFinite(n) ? n : fallback;
};

export const safeDiv = (a: unknown, b: unknown, fallback = 0): number => {
  const nb = safeNumber(b);
  return nb !== 0 ? safeNumber(a) / nb : fallback;
};

export const safePercent = (a: unknown, b: unknown): number => safeDiv(a, b) * 100;

export interface LaunchKPIInput {
  meta_investment?: number | string | null;
  meta_leads?: number | string | null;
  google_investment?: number | string | null;
  google_leads?: number | string | null;
  tiktok_investment?: number | string | null;
  tiktok_leads?: number | string | null;
  contactos_api?: number | string | null;
  ingresos_whatsapp?: number | string | null;
  registrados?: number | string | null;
  asistentes?: number | string | null;
  hasta_pitch?: number | string | null;
  ventas_total?: number | string | null;
  revenue?: number | string | null;
}

export interface LaunchKPIs {
  metaInv: number;
  metaLeads: number;
  googleInv: number;
  googleLeads: number;
  tiktokInv: number;
  tiktokLeads: number;
  contactosAPI: number;
  whatsappRevenue: number;
  revenue: number;
  registrados: number;
  asistentes: number;
  hastaPitch: number;
  ventas: number;
  totalLeads: number;
  totalInvestment: number;
  cplMeta: number;
  cplGoogle: number;
  cplTiktok: number;
  whatsappRevenueShare: number;
  roas: number;
  cac: number;
  showRate: number;
  closeRate: number;
  profit: number;
}

export function calculateLaunchKPIs(l: LaunchKPIInput | null | undefined): LaunchKPIs {
  if (!l) {
    return {
      metaInv: 0,
      metaLeads: 0,
      googleInv: 0,
      googleLeads: 0,
      tiktokInv: 0,
      tiktokLeads: 0,
      contactosAPI: 0,
      whatsappRevenue: 0,
      revenue: 0,
      registrados: 0,
      asistentes: 0,
      hastaPitch: 0,
      ventas: 0,
      totalLeads: 0,
      totalInvestment: 0,
      cplMeta: 0,
      cplGoogle: 0,
      cplTiktok: 0,
      whatsappRevenueShare: 0,
      roas: 0,
      cac: 0,
      showRate: 0,
      closeRate: 0,
      profit: 0,
    };
  }

  const metaInv = safeNumber(l.meta_investment);
  const metaLeads = safeInt(l.meta_leads);
  const googleInv = safeNumber(l.google_investment);
  const googleLeads = safeInt(l.google_leads);
  const tiktokInv = safeNumber(l.tiktok_investment);
  const tiktokLeads = safeInt(l.tiktok_leads);
  const contactosAPI = safeInt(l.contactos_api);
  const whatsappRevenue = safeNumber(l.ingresos_whatsapp);
  const revenue = safeNumber(l.revenue);
  const registrados = safeInt(l.registrados);
  const asistentes = safeInt(l.asistentes);
  const hastaPitch = safeInt(l.hasta_pitch);
  const ventas = safeInt(l.ventas_total);

  const totalLeads = metaLeads + googleLeads + tiktokLeads;
  const totalInvestment = metaInv + googleInv + tiktokInv;

  return {
    metaInv,
    metaLeads,
    googleInv,
    googleLeads,
    tiktokInv,
    tiktokLeads,
    contactosAPI,
    whatsappRevenue,
    revenue,
    registrados,
    asistentes,
    hastaPitch,
    ventas,
    totalLeads,
    totalInvestment,
    cplMeta: safeDiv(metaInv, metaLeads),
    cplGoogle: safeDiv(googleInv, googleLeads),
    cplTiktok: safeDiv(tiktokInv, tiktokLeads),
    whatsappRevenueShare: safePercent(whatsappRevenue, revenue),
    roas: safeDiv(revenue, totalInvestment),
    cac: safeDiv(totalInvestment, ventas),
    showRate: safePercent(asistentes, registrados),
    closeRate: safePercent(ventas, asistentes),
    profit: revenue - totalInvestment,
  };
}
