import {
  fmtMoney,
  fmtMoneyDecimals,
  fmtMultiplier,
  fmtNumber,
  fmtPercent,
} from "@/lib/format";
import type { LaunchKPIs } from "@/lib/kpis";

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

export function KpiGrid({ kpi }: { readonly kpi: LaunchKPIs }) {
  const profitEmphasis =
    kpi.profit > 0 ? "positive" : kpi.profit < 0 ? "negative" : "neutral";

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <KpiCard label="Revenue" value={fmtMoney(kpi.revenue)} />
      <KpiCard label="Inversión total" value={fmtMoney(kpi.totalInvestment)} />
      <KpiCard
        label="Profit"
        value={fmtMoney(kpi.profit)}
        emphasis={profitEmphasis}
      />
      <KpiCard label="ROAS" value={fmtMultiplier(kpi.roas)} />

      <KpiCard label="CAC" value={fmtMoneyDecimals(kpi.cac)} />
      <KpiCard label="Leads totales" value={fmtNumber(kpi.totalLeads)} />
      <KpiCard label="Show rate" value={fmtPercent(kpi.showRate)} />
      <KpiCard label="Close rate" value={fmtPercent(kpi.closeRate)} />

      <KpiCard
        label="CPL Meta"
        value={fmtMoneyDecimals(kpi.cplMeta)}
        hint={`${fmtNumber(kpi.metaLeads)} leads · ${fmtMoney(kpi.metaInv)} invertido`}
      />
      <KpiCard
        label="CPL Google"
        value={fmtMoneyDecimals(kpi.cplGoogle)}
        hint={`${fmtNumber(kpi.googleLeads)} leads · ${fmtMoney(kpi.googleInv)} invertido`}
      />
      <KpiCard
        label="CPL TikTok"
        value={fmtMoneyDecimals(kpi.cplTiktok)}
        hint={`${fmtNumber(kpi.tiktokLeads)} leads · ${fmtMoney(kpi.tiktokInv)} invertido`}
      />
      <KpiCard
        label="% WhatsApp del revenue"
        value={fmtPercent(kpi.whatsappRevenueShare)}
        hint={`${fmtMoney(kpi.whatsappRevenue)} de ${fmtMoney(kpi.revenue)}`}
      />
    </div>
  );
}
