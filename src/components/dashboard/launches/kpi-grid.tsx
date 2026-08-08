import {
  fmtMoney,
  fmtMoneyDecimals,
  fmtMultiplier,
  fmtNumber,
  fmtPercent,
  fmtPercentOrDash,
} from "@/lib/format";
import type { LaunchKPIs } from "@/lib/kpis";
import { fmtUsd, fmtUsdDecimals } from "@/lib/money";

function KpiCard({
  label,
  value,
  hint,
  emphasis,
}: {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly emphasis?: "neutral" | "positive" | "negative";
}) {
  const valueColor =
    emphasis === "negative"
      ? "text-error"
      : emphasis === "positive"
        ? "text-success"
        : "text-fg";

  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <div className="text-xs uppercase tracking-wide text-fg-subtle">{label}</div>
      <div className={`mt-2 text-xl font-bold ${valueColor}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-fg-muted">{hint}</div>}
    </div>
  );
}

export function KpiGrid({
  kpi,
  launchArsPerUsd,
  kpisInUsd,
  hideRevenueKpis,
}: {
  readonly kpi: LaunchKPIs;
  /**
   * Tasa del launch para convertir todos los montos a USD antes de renderear.
   * Si es null/undefined, los montos se muestran tal cual con el formato
   * legacy — se asume que el launch se opera en USD nativo o que la
   * conversión no aplica.
   */
  readonly launchArsPerUsd?: number | null;
  /**
   * Cuando true, los valores en `kpi` ya están en USD (pre-convertidos en
   * el server). Se muestra directo con fmtUsd sin dividir por rate.
   * Cuando false/undefined: comportamiento legacy (kpi-grid divide por rate).
   */
  readonly kpisInUsd?: boolean;
  /**
   * Cuando true, oculta Revenue estimado, Revenue cobrado, CAC, ROAS (est/real),
   * Profit (est/real) y "% WhatsApp del revenue". Rol operador (regla 2026-08-08):
   * no ve dinero facturado, solo ejecución (inversión, leads, funnel, CPL).
   */
  readonly hideRevenueKpis?: boolean;
}) {
  // Helpers: si hay tasa del launch, dividimos y usamos fmtUsd (prefijo US$).
  // Sin tasa: legacy `fmtMoney` sin distinción.
  const rate =
    launchArsPerUsd && launchArsPerUsd > 0 ? launchArsPerUsd : null;
  const fMoney = kpisInUsd
    ? fmtUsd
    : rate
      ? (n: number) => fmtUsd(n / rate)
      : (n: number) => fmtMoney(n);
  const fMoneyDec = kpisInUsd
    ? fmtUsdDecimals
    : rate
      ? (n: number) => fmtUsdDecimals(n / rate)
      : (n: number) => fmtMoneyDecimals(n);

  const profitEstEmphasis =
    kpi.profitEstimated > 0
      ? "positive"
      : kpi.profitEstimated < 0
        ? "negative"
        : "neutral";
  const profitRealEmphasis =
    kpi.profitReal > 0
      ? "positive"
      : kpi.profitReal < 0
        ? "negative"
        : "neutral";

  // Footers de funnel: si falta el denominador, el KPI muestra "—". Los
  // footers describen exactamente la cuenta para que el equipo entienda
  // qué se está dividiendo.
  const showRateHint =
    kpi.showRate == null
      ? "Cargá Inscriptos y Asistentes Clase 1 para ver Show Rate"
      : `${fmtNumber(kpi.asistentes)} de ${fmtNumber(kpi.registrados)} inscriptos · pico simultáneo Clase 1`;

  const closeRateC1Hint =
    kpi.closeRate == null
      ? "Cargá Asistentes Clase 1 para ver Close Rate"
      : `${fmtNumber(kpi.hastaPitch)} de ${fmtNumber(kpi.asistentes)} asistentes Clase 1 retenidos hasta Clase 3 · pico simultáneo`;

  const closeRateC3Hint =
    kpi.closeRateC3 == null
      ? "Cargá Asistentes Clase 3 para ver Close Rate hasta el pitch"
      : `${fmtNumber(kpi.ventas)} de ${fmtNumber(kpi.hastaPitch)} asistentes Clase 3 / pitch · pico simultáneo`;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {!hideRevenueKpis && (
        <>
          <KpiCard
            label="Revenue estimado"
            value={fMoney(kpi.revenueEstimated)}
            hint={`Suma de montos pactados de ${fmtNumber(kpi.ventas)} ventas`}
          />
          <KpiCard
            label="Revenue cobrado"
            value={fMoney(kpi.revenueCollected)}
            hint="Suma de cobros registrados"
          />
        </>
      )}
      <KpiCard
        label="Inversión total"
        value={fMoney(kpi.totalInvestment)}
        hint={
          kpisInUsd
            ? "Meta + Google + TikTok · en USD"
            : rate
              ? "Meta + Google + TikTok · convertido a USD con la tasa del launch"
              : "Meta + Google + TikTok"
        }
      />
      {!hideRevenueKpis && (
        <KpiCard
          label="CAC"
          value={fMoneyDec(kpi.cac)}
          hint={`${fMoney(kpi.totalInvestment)} invertido / ${fmtNumber(kpi.ventas)} ventas`}
        />
      )}

      {!hideRevenueKpis && (
        <>
          <KpiCard
            label="ROAS estimado"
            value={fmtMultiplier(kpi.roasEstimated)}
            hint={`${fMoney(kpi.revenueEstimated)} pactado / ${fMoney(kpi.totalInvestment)} invertido`}
          />
          <KpiCard
            label="ROAS real"
            value={fmtMultiplier(kpi.roasReal)}
            hint={`${fMoney(kpi.revenueCollected)} cobrado / ${fMoney(kpi.totalInvestment)} invertido`}
          />
          <KpiCard
            label="Profit estimado"
            value={fMoney(kpi.profitEstimated)}
            emphasis={profitEstEmphasis}
            hint={`${fMoney(kpi.revenueEstimated)} pactado − ${fMoney(kpi.totalInvestment)} invertido`}
          />
          <KpiCard
            label="Profit real"
            value={fMoney(kpi.profitReal)}
            emphasis={profitRealEmphasis}
            hint={`${fMoney(kpi.revenueCollected)} cobrado − ${fMoney(kpi.totalInvestment)} invertido`}
          />
        </>
      )}

      <KpiCard
        label="Leads totales"
        value={fmtNumber(kpi.totalLeads)}
        hint="Meta + Google + TikTok"
      />
      <KpiCard
        label="Show rate"
        value={fmtPercentOrDash(kpi.showRate)}
        hint={showRateHint}
      />
      <KpiCard
        label="Close rate"
        value={fmtPercentOrDash(kpi.closeRate)}
        hint={closeRateC1Hint}
      />
      <KpiCard
        label="Close rate hasta el pitch"
        value={fmtPercentOrDash(kpi.closeRateC3)}
        hint={closeRateC3Hint}
      />

      {!hideRevenueKpis && (
        <KpiCard
          label="% WhatsApp del revenue"
          value={fmtPercent(kpi.whatsappRevenueShare)}
          hint={`${fMoney(kpi.whatsappRevenue)} de ${fMoney(kpi.revenueEstimated)}`}
        />
      )}

      <KpiCard
        label="CPL Meta"
        value={fMoneyDec(kpi.cplMeta)}
        hint={`${fMoney(kpi.metaInv)} / ${fmtNumber(kpi.metaLeads)} leads`}
      />
      <KpiCard
        label="CPL Google"
        value={fMoneyDec(kpi.cplGoogle)}
        hint={`${fMoney(kpi.googleInv)} / ${fmtNumber(kpi.googleLeads)} leads`}
      />
      <KpiCard
        label="CPL TikTok"
        value={fMoneyDec(kpi.cplTiktok)}
        hint={`${fMoney(kpi.tiktokInv)} / ${fmtNumber(kpi.tiktokLeads)} leads`}
      />
    </div>
  );
}
