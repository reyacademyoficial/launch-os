"use client";

import { HeroKpi, type HeroKpiTone } from "@/components/kg/hero-kpi";
import { SupportKpi, type SupportKpiTone } from "@/components/kg/support-kpi";
import {
  fmtMoney,
  fmtMoneyDecimals,
  fmtMultiplier,
  fmtNumber,
  fmtPercent,
} from "@/lib/format";
import type { LaunchKPIs } from "@/lib/kpis";
import { fmtUsd, fmtUsdDecimals } from "@/lib/money";

/**
 * Bento de KPIs de un lanzamiento.
 *
 * POR QUÉ AHORA ES CLIENT
 * `HeroKpi` y `SupportKpi` reciben `format` como FUNCIÓN, y las funciones no
 * cruzan el boundary RSC. Como este componente ya recibía todo serializable
 * (`LaunchKPIs` es un objeto plano + primitivas), marcarlo client no cambia
 * nada para sus callers. Mismo corte que `overview-kpis.tsx`.
 *
 * JERARQUÍA (regla del design system)
 * Los 17 `KpiCard` locales pesaban todos igual: una grilla plana donde
 * "Revenue estimado" y "CPL TikTok" gritaban lo mismo. Ahora hay dos niveles —
 * `HeroKpi` para las dos cifras que se miran primero, `SupportKpi` para el
 * resto. Cuáles suben depende del rol: con `hideRevenueKpis` (operador) no hay
 * plata que mostrar, así que arriba van Inversión y Leads.
 *
 * LA PLATA NO SE PINTA
 * El `emphasis` que teñía Profit de verde o rojo se fue. El signo del número
 * ya dice la dirección; el tono viaja en el `StateDot` del KPI. Ver `tone.ts`.
 *
 * LOS HINTS PASARON A TOOLTIP
 * Los `hint` que colgaban de cada card ahora son `help` (el ⓘ). Son
 * explicaciones de cómo se calcula cada métrica: quien las necesita las abre,
 * y sacarlas del flujo deja leer los 17 números de un vistazo.
 *
 * La firma pública NO cambia: la consumen `kpi/page.tsx` y el portal de
 * cliente (`(cliente)/portal/proyectos/[id]/launches/[launchId]/page.tsx`).
 */

/** Formateador tolerante a KPIs sin denominador (`null` → NaN → "—"). */
function pctOrDash(n: number): string {
  return Number.isFinite(n) ? fmtPercent(n) : "—";
}

export function KpiGrid({
  kpi,
  launchArsPerUsd,
  kpisInUsd,
  hideRevenueKpis,
  ghlNewLeads,
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
  /**
   * Leads capturados por GHL durante la ventana del launch (contacts nuevos
   * con `dateAdded` in [date_start, date_end]). Se muestra en una card
   * aparte — NO se suma a "Leads totales" (que es solo Meta/Google/TikTok).
   */
  readonly ghlNewLeads?: number;
}) {
  // Helpers: si hay tasa del launch, dividimos y usamos fmtUsd (prefijo US$).
  // Sin tasa: legacy `fmtMoney` sin distinción.
  const rate = launchArsPerUsd && launchArsPerUsd > 0 ? launchArsPerUsd : null;
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

  const investmentHelp = kpisInUsd
    ? "Meta + Google + TikTok · en USD."
    : rate
      ? "Meta + Google + TikTok · convertido a USD con la tasa del launch."
      : "Meta + Google + TikTok.";

  const amountTone = (n: number): HeroKpiTone =>
    n > 0 ? "positive" : n < 0 ? "negative" : "neutral";
  // ROAS < 1 = el lanzamiento no recupera lo que gasta en pauta. Es el umbral
  // que el operador mira primero.
  const roasTone = (n: number): SupportKpiTone =>
    Number.isFinite(n) && n >= 1 ? "positive" : "negative";

  // Si falta el denominador el KPI muestra "—". Estos textos describen
  // exactamente la cuenta, para que el equipo entienda qué se está dividiendo.
  const showRateHelp =
    kpi.showRate == null
      ? "Cargá Inscriptos y Asistentes Clase 1 para ver Show Rate."
      : `${fmtNumber(kpi.asistentes)} de ${fmtNumber(kpi.registrados)} inscriptos · pico simultáneo Clase 1.`;

  const closeRateC1Help =
    kpi.closeRate == null
      ? "Cargá Asistentes Clase 1 para ver Close Rate."
      : `${fmtNumber(kpi.hastaPitch)} de ${fmtNumber(kpi.asistentes)} asistentes Clase 1 retenidos hasta Clase 3 · pico simultáneo.`;

  const closeRateC3Help =
    kpi.closeRateC3 == null
      ? "Cargá Asistentes Clase 3 para ver Close Rate hasta el pitch."
      : `${fmtNumber(kpi.ventas)} de ${fmtNumber(kpi.hastaPitch)} asistentes Clase 3 / pitch · pico simultáneo.`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ── Fila 1 · los dos números que se miran primero ── */}
      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
        {hideRevenueKpis ? (
          <>
            <HeroKpi
              label="Inversión total"
              value={kpi.totalInvestment}
              format={fMoney}
              featured
              help={investmentHelp}
            />
            <HeroKpi
              label="Leads totales"
              value={kpi.totalLeads}
              format={fmtNumber}
              help="Meta + Google + TikTok."
            />
          </>
        ) : (
          <>
            <HeroKpi
              label="Revenue estimado"
              value={kpi.revenueEstimated}
              format={fMoney}
              featured
              help={`Suma de montos pactados de ${fmtNumber(kpi.ventas)} ventas.`}
            />
            <HeroKpi
              label="Profit real"
              value={kpi.profitReal}
              format={fMoney}
              tone={amountTone(kpi.profitReal)}
              help={`${fMoney(kpi.revenueCollected)} cobrado − ${fMoney(kpi.totalInvestment)} invertido.`}
            />
          </>
        )}
      </div>

      {/* ── Fila 2 · el resto, todos del mismo peso ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {!hideRevenueKpis && (
          <>
            <SupportKpi
              label="Revenue cobrado"
              value={kpi.revenueCollected}
              format={fMoney}
              help="Suma de cobros registrados."
            />
            <SupportKpi
              label="Inversión total"
              value={kpi.totalInvestment}
              format={fMoney}
              help={investmentHelp}
            />
            <SupportKpi
              label="CAC"
              value={kpi.cac}
              format={fMoneyDec}
              help={`${fMoney(kpi.totalInvestment)} invertido / ${fmtNumber(kpi.ventas)} ventas.`}
            />
            <SupportKpi
              label="ROAS estimado"
              value={kpi.roasEstimated}
              format={fmtMultiplier}
              tone={roasTone(kpi.roasEstimated)}
              help={`${fMoney(kpi.revenueEstimated)} pactado / ${fMoney(kpi.totalInvestment)} invertido.`}
            />
            <SupportKpi
              label="ROAS real"
              value={kpi.roasReal}
              format={fmtMultiplier}
              tone={roasTone(kpi.roasReal)}
              help={`${fMoney(kpi.revenueCollected)} cobrado / ${fMoney(kpi.totalInvestment)} invertido.`}
            />
            <SupportKpi
              label="Profit estimado"
              value={kpi.profitEstimated}
              format={fMoney}
              tone={amountTone(kpi.profitEstimated)}
              help={`${fMoney(kpi.revenueEstimated)} pactado − ${fMoney(kpi.totalInvestment)} invertido.`}
            />
            <SupportKpi
              label="Leads totales"
              value={kpi.totalLeads}
              format={fmtNumber}
              help="Meta + Google + TikTok."
            />
          </>
        )}

        <SupportKpi
          label="Show rate"
          value={kpi.showRate ?? Number.NaN}
          format={pctOrDash}
          help={showRateHelp}
        />
        <SupportKpi
          label="Close rate"
          value={kpi.closeRate ?? Number.NaN}
          format={pctOrDash}
          help={closeRateC1Help}
        />
        <SupportKpi
          label="Close rate hasta el pitch"
          value={kpi.closeRateC3 ?? Number.NaN}
          format={pctOrDash}
          help={closeRateC3Help}
        />

        {!hideRevenueKpis && (
          <SupportKpi
            label="% WhatsApp del revenue"
            value={kpi.whatsappRevenueShare}
            format={fmtPercent}
            help={`${fMoney(kpi.whatsappRevenue)} de ${fMoney(kpi.revenueEstimated)}.`}
          />
        )}

        <SupportKpi
          label="CPL Meta"
          value={kpi.cplMeta}
          format={fMoneyDec}
          help={`${fMoney(kpi.metaInv)} / ${fmtNumber(kpi.metaLeads)} leads.`}
        />
        <SupportKpi
          label="CPL Google"
          value={kpi.cplGoogle}
          format={fMoneyDec}
          help={`${fMoney(kpi.googleInv)} / ${fmtNumber(kpi.googleLeads)} leads.`}
        />
        <SupportKpi
          label="CPL TikTok"
          value={kpi.cplTiktok}
          format={fMoneyDec}
          help={`${fMoney(kpi.tiktokInv)} / ${fmtNumber(kpi.tiktokLeads)} leads.`}
        />

        {ghlNewLeads !== undefined && (
          <SupportKpi
            label="Leads GHL"
            value={ghlNewLeads}
            format={fmtNumber}
            help="Contacts nuevos en GHL durante el launch. No se suma a Leads totales."
          />
        )}
      </div>
    </div>
  );
}
