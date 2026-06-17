import { fmtNumber, fmtPercent } from "@/lib/format";
import type { LaunchKPIs } from "@/lib/kpis";

/**
 * Bloque "Comunidad (SendFlow)". Se renderiza abajo del KpiGrid principal,
 * separado conceptualmente de las métricas de ads.
 *
 * Reglas de visibilidad (decisión "B + C"):
 *  - `enteredCommunity === 0` → NO se renderiza. Si no hay sync de SendFlow
 *    no queremos sumar ruido vacío al dashboard.
 *  - rates `null` (denominador 0) → mostramos "—" en vez de "0.0%". Indica
 *    que no se pudo calcular, NO que dio cero.
 */
export function CommunityKpiBlock({ kpi }: { readonly kpi: LaunchKPIs }) {
  if (kpi.enteredCommunity === 0) return null;

  const retentionStr =
    kpi.retentionRate === null ? "—" : fmtPercent(kpi.retentionRate);
  const enteredRateStr =
    kpi.enteredCommunityRate === null
      ? "—"
      : fmtPercent(kpi.enteredCommunityRate);

  const retentionHint = `${fmtNumber(kpi.enteredCommunity)} entraron · ${fmtNumber(kpi.leftCommunity)} salieron`;
  const enteredRateHint =
    kpi.enteredCommunityRate === null
      ? "Sin leads de ads para usar como base"
      : `${fmtNumber(kpi.enteredCommunity)} sobre ${fmtNumber(Math.round(kpi.enteredCommunity / (kpi.enteredCommunityRate / 100)))} leads totales`;

  return (
    <section className="space-y-3">
      <header>
        <h2 className="text-base font-semibold text-fg">Comunidad (SendFlow)</h2>
        <p className="text-xs text-fg-subtle">
          Métricas de la comunidad de WhatsApp del lanzamiento.
        </p>
      </header>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <div className="rounded-md border border-border bg-surface p-4">
          <div className="text-xs uppercase tracking-wide text-fg-subtle">
            Retención
          </div>
          <div className="mt-2 text-xl font-bold text-fg">{retentionStr}</div>
          <div className="mt-1 text-xs text-fg-muted">{retentionHint}</div>
        </div>
        <div className="rounded-md border border-border bg-surface p-4">
          <div className="text-xs uppercase tracking-wide text-fg-subtle">
            % leads que entraron
          </div>
          <div className="mt-2 text-xl font-bold text-fg">{enteredRateStr}</div>
          <div className="mt-1 text-xs text-fg-muted">{enteredRateHint}</div>
        </div>
        <div className="rounded-md border border-border bg-surface p-4">
          <div className="text-xs uppercase tracking-wide text-fg-subtle">
            Clicks
          </div>
          <div className="mt-2 text-xl font-bold text-fg">
            {fmtNumber(kpi.communityClicks)}
          </div>
          <div className="mt-1 text-xs text-fg-muted">
            Sobre links de la comunidad
          </div>
        </div>
      </div>
    </section>
  );
}
