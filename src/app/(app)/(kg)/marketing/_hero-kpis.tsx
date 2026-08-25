"use client";

import { HeroKpi, type HeroKpiTone } from "@/components/kg/hero-kpi";
import { fCount } from "@/lib/finance/format";

interface Props {
  readonly totalStockCount: number;
  readonly minDays: number | null;
  readonly minDaysTone: HeroKpiTone;
  readonly upcomingSessionsCount: number;
  readonly editedLast7d: number;
}

function fDaysOrDash(n: number): string {
  return Number.isFinite(n) ? String(n) : "—";
}

export function MarketingHeroKpis({
  totalStockCount,
  minDays,
  minDaysTone,
  upcomingSessionsCount,
  editedLast7d,
}: Props) {
  return (
    <div className="grid grid-cols-1 items-start gap-5 sm:grid-cols-2 lg:grid-cols-4">
      <HeroKpi
        label="Contenido en stock"
        value={totalStockCount}
        format={fCount}
        sub="Assets editados listos para subir"
        tone="accent"
        featured
        help="Assets con edited_at seteado y todavía no consumidos (respetando allow_repeat_asset de cada cadencia)."
      />
      <HeroKpi
        label="Días mínimos de cobertura"
        value={minDays ?? Number.NaN}
        format={fDaysOrDash}
        sub={
          minDays == null
            ? "Sin cadencias configuradas"
            : "El par owner×platform peor parado"
        }
        tone={minDaysTone}
        help="Se calcula por (owner, platform) sumando stock a través de formats y dividiendo por posts_per_day."
      />
      <HeroKpi
        label="Grabaciones próximas"
        value={upcomingSessionsCount}
        format={fCount}
        sub="Próximos 14 días"
        tone="neutral"
      />
      <HeroKpi
        label="Editados esta semana"
        value={editedLast7d}
        format={fCount}
        sub="Últimos 7 días"
        tone="neutral"
      />
    </div>
  );
}
