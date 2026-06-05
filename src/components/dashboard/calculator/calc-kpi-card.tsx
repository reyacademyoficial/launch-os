/**
 * KPI card variant for the calculator. Differs from the launches KpiGrid card
 * because each calc KPI carries its own color (magenta for sales targets,
 * red for spend ceilings, green for profit, etc. — mirrors the prototype).
 */
export function CalcKpiCard({
  label,
  value,
  color,
}: {
  readonly label: string;
  readonly value: string;
  readonly color: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-md border border-border bg-surface p-4">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px"
        style={{
          background: `linear-gradient(90deg, transparent, ${color}55, transparent)`,
        }}
      />
      <div className="text-xs uppercase tracking-wide text-fg-subtle">{label}</div>
      <div className="mt-2 text-xl font-bold leading-none" style={{ color }}>
        {value}
      </div>
    </div>
  );
}
