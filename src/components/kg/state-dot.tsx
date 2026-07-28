import { TONE_VAR, type KgTone } from "./tone";

/**
 * KG · StateDot. Punto 5px del tono semántico. Único lugar donde vive el
 * color de estado — si no hay tono válido, no renderiza (silencio > semáforo
 * incorrecto).
 */
export function StateDot({
  tone,
  size = 5,
}: {
  readonly tone: KgTone | null | undefined;
  readonly size?: number;
}) {
  if (!tone || !TONE_VAR[tone]) return null;
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: TONE_VAR[tone],
        flexShrink: 0,
        display: "inline-block",
      }}
    />
  );
}
