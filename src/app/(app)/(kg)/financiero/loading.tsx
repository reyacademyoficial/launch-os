import { Skeleton } from "@/components/kg/skeleton";

/**
 * Loading state del dashboard Financiero. Refleja la estructura del bento:
 * ContextBar + fila hero (4) + fila P&L/tendencia + fila support (6) +
 * StatRow + fila paneles. Nunca spinners — el skeleton tiene la forma real
 * (regla del design system).
 */
export default function FinancieroLoading() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Skeleton h={52} r={16} />
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Skeleton h={26} w={220} r={999} />
      </div>
      <Row cols={4} h={168} r={20} />
      <div style={{ display: "grid", gap: 20, gridTemplateColumns: "5fr 7fr" }}>
        <Skeleton h={260} r={20} />
        <Skeleton h={260} r={20} />
      </div>
      <Row cols={6} h={104} r={16} />
      <Skeleton h={44} r={16} />
      <div style={{ display: "grid", gap: 20, gridTemplateColumns: "7fr 5fr" }}>
        <Skeleton h={280} r={20} />
        <Skeleton h={280} r={20} />
      </div>
      <Skeleton h={220} r={20} />
    </div>
  );
}

function Row({
  cols,
  h,
  r,
}: {
  readonly cols: number;
  readonly h: number;
  readonly r: number;
}) {
  return (
    <div style={{ display: "grid", gap: 20, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton key={i} h={h} r={r} />
      ))}
    </div>
  );
}
