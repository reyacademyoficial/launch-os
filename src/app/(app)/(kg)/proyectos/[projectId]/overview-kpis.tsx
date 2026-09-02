"use client";

import { HeroKpi, type HeroKpiTone } from "@/components/kg/hero-kpi";
import { SupportKpi, type SupportKpiTone } from "@/components/kg/support-kpi";
import { fmtMoney, fmtMoneyDecimals, fmtMultiplier, fmtNumber, fmtPercent } from "@/lib/format";
import { fmtUsd, fmtUsdDecimals } from "@/lib/money";

/**
 * Bento de KPIs agregados del proyecto.
 *
 * ¿Por qué un componente client aparte y no JSX dentro de `page.tsx`?
 * `HeroKpi` y `SupportKpi` reciben `format` como FUNCIÓN, y las funciones no
 * cruzan el boundary RSC — una page server no se las puede pasar. Es el mismo
 * corte que hace Financiero: `financiero/page.tsx` (server) calcula y
 * `financiero/dashboard.tsx` (client) compone el bento.
 *
 * Por eso este componente recibe NÚMEROS crudos y el booleano `inUsd`, y elige
 * el formateador de este lado. Nada de lógica de negocio acá: los agregados
 * los calcula `aggregateProjectKPIs` en el server.
 *
 * Jerarquía visual (regla del DS): Revenue y Profit son los dos HeroKpi —
 * la plata es lo que se mira primero. El resto son SupportKpi. El color
 * semántico va en el StateDot del tono, NUNCA pintando el número.
 */
export interface OverviewKpisData {
  readonly totalRevenue: number;
  readonly totalInvestment: number;
  readonly totalProfit: number;
  readonly aggregateROAS: number;
  readonly aggregateCAC: number;
  readonly totalLeads: number;
  readonly aggregateShowRate: number;
  readonly aggregateCloseRate: number;
  readonly totalVentas: number;
  readonly totalAsistentes: number;
  readonly totalRegistrados: number;
  /** true = los agregados están en USD; false = moneda local. */
  readonly inUsd: boolean;
}

export function OverviewKpis({ data }: { readonly data: OverviewKpisData }) {
  const fAgg = data.inUsd ? fmtUsd : fmtMoney;
  const fAggDec = data.inUsd ? fmtUsdDecimals : fmtMoneyDecimals;

  const profitTone: HeroKpiTone =
    data.totalProfit >= 0 ? "positive" : "negative";
  // ROAS < 1 = el lanzamiento no paga su propia pauta. Es el umbral que el
  // operador mira primero, así que lleva tono.
  const roasTone: SupportKpiTone =
    data.aggregateROAS >= 1 ? "positive" : "negative";

  return (
    <>
      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
        <HeroKpi
          label="Revenue total"
          value={data.totalRevenue}
          format={fAgg}
          featured
        />
        <HeroKpi
          label="Profit"
          value={data.totalProfit}
          format={fAgg}
          tone={profitTone}
          help="Revenue total menos inversión total, sumando todos los lanzamientos del proyecto."
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SupportKpi
          label="Inversión total"
          value={data.totalInvestment}
          format={fAgg}
        />
        <SupportKpi
          label="ROAS agregado"
          value={data.aggregateROAS}
          format={fmtMultiplier}
          tone={roasTone}
          help="Revenue dividido inversión. Abajo de 1x el proyecto no recupera lo que gasta en pauta."
        />
        <SupportKpi
          label="CAC agregado"
          value={data.aggregateCAC}
          format={fAggDec}
          help={`Inversión total dividida por las ${fmtNumber(data.totalVentas)} ventas del proyecto.`}
        />
        <SupportKpi
          label="Leads totales"
          value={data.totalLeads}
          format={fmtNumber}
          help="Meta + Google + TikTok."
        />
        <SupportKpi
          label="Show rate agregado"
          value={data.aggregateShowRate}
          format={fmtPercent}
          help={`${fmtNumber(data.totalAsistentes)} asistentes sobre ${fmtNumber(data.totalRegistrados)} registrados.`}
        />
        <SupportKpi
          label="Close rate agregado"
          value={data.aggregateCloseRate}
          format={fmtPercent}
          help={`${fmtNumber(data.totalVentas)} ventas sobre ${fmtNumber(data.totalAsistentes)} asistentes.`}
        />
      </div>
    </>
  );
}
