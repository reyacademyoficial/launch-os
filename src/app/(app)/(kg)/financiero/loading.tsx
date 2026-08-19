import { Skeleton } from "@/components/kg/skeleton";

/**
 * Loading state del dashboard Financiero. Refleja la estructura del bento:
 * ContextBar + fila hero (4) + fila P&L/tendencia + fila support (6) +
 * StatRow + fila paneles. Nunca spinners — el skeleton tiene la forma real
 * (regla del design system).
 *
 * Las grillas usan las mismas clases Tailwind que el dashboard real
 * (`FinancieroDashboard`) para que el layout no salte al terminar la carga:
 * misma cantidad de filas, mismos breakpoints por fila.
 */
export default function FinancieroLoading() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Skeleton h={52} r={16} />
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Skeleton h={26} w={220} r={999} />
      </div>
      {/* Fila 1 — 4 HeroKpi (1 / sm:2 / lg:4) */}
      <ResponsiveRow className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-4" count={4} h={168} r={20} />
      {/* Fila 2 — P&L (5/12) + Tendencia (7/12) */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <Skeleton h={260} r={20} />
        </div>
        <div className="lg:col-span-7">
          <Skeleton h={260} r={20} />
        </div>
      </div>
      {/* Fila 3 — 6 SupportKpi (1 / sm:2 / md:3 / lg:6) */}
      <ResponsiveRow className="grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6" count={6} h={104} r={16} />
      <Skeleton h={44} r={16} />
      {/* Fila 4 — Liquidaciones (7/12) + Egresos (5/12) */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <Skeleton h={280} r={20} />
        </div>
        <div className="lg:col-span-5">
          <Skeleton h={280} r={20} />
        </div>
      </div>
      <Skeleton h={220} r={20} />
    </div>
  );
}

function ResponsiveRow({
  className,
  count,
  h,
  r,
}: {
  readonly className: string;
  readonly count: number;
  readonly h: number;
  readonly r: number;
}) {
  return (
    <div className={`grid gap-5 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} h={h} r={r} />
      ))}
    </div>
  );
}
