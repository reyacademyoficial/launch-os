/**
 * KG · Halo. Luz ambiental radial, 6-10% de opacidad. Es firma visual — se
 * posiciona absolute dentro de un contenedor con `position: relative` y
 * queda como resplandor de fondo, nunca protagonista.
 */
export function Halo({
  tone = "var(--kg-accent-500)",
  op = 0.09,
  size = 190,
  top = -60,
  right = -40,
}: {
  readonly tone?: string;
  readonly op?: number;
  readonly size?: number;
  readonly top?: number;
  readonly right?: number;
}) {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        top,
        right,
        width: size,
        height: size,
        borderRadius: 999,
        background: `radial-gradient(circle, ${tone} 0%, transparent 68%)`,
        opacity: op,
        pointerEvents: "none",
        filter: "blur(14px)",
      }}
    />
  );
}
