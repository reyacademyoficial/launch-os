/**
 * KG · Skeleton. Placeholder con la forma del contenido, nunca spinner. El
 * shimmer viene de `.kg-skel` en globals.css (linear-gradient + kg-shim
 * animation).
 */
export function Skeleton({
  h = 14,
  w = "100%",
  r = 8,
  mb = 0,
}: {
  readonly h?: number | string;
  readonly w?: number | string;
  readonly r?: number;
  readonly mb?: number;
}) {
  return (
    <div
      className="kg-skel"
      style={{ height: h, width: w, borderRadius: r, marginBottom: mb }}
    />
  );
}
