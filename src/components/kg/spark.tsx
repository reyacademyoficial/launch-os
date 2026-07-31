/**
 * KG · Spark. Sparkline SVG minimalista. Ignora valores no-finitos y devuelve
 * null si quedan menos de 2 puntos válidos.
 */
export function Spark({
  data,
  color,
  w = 74,
  h = 22,
}: {
  readonly data: ReadonlyArray<number | null | undefined> | null | undefined;
  readonly color: string;
  readonly w?: number;
  readonly h?: number;
}) {
  const vals = (data ?? [])
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));
  if (vals.length < 2) return null;

  const mx = Math.max(...vals);
  const mn = Math.min(...vals);
  const rg = mx - mn || 1;
  const pts = vals
    .map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - mn) / rg) * h}`)
    .join(" ");

  return (
    <svg width={w} height={h} style={{ display: "block" }} aria-hidden>
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
