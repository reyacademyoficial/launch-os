/**
 * KG · Tono semántico.
 *
 * Principio del design system: **el color semántico viaja separado del dato**.
 * Nunca se pinta un número con el color de su estado (queda tipo semáforo).
 * El estado se muestra con un StateDot al lado, o con un pill sin fondo tinto,
 * o con la flecha del Delta — nunca sobre el propio valor.
 *
 * `TONE_VAR` mapea el tono a una CSS var (respeta dark/light).
 * `TONE_MAP` es la tabla inversa por conveniencia — si un módulo decide un
 * color hex hardcoded para un umbral, `toneOf(color)` lo traduce a tono. Cae a
 * `null` si el color no matchea (permite pasar `undefined`/randoms sin romper).
 */

export type KgTone = "positive" | "negative" | "warning" | "accent";

export const TONE_VAR: Record<KgTone, string> = {
  positive: "var(--kg-positive-500)",
  negative: "var(--kg-negative-500)",
  warning: "var(--kg-warning-500)",
  accent: "var(--kg-accent-500)",
};

const TONE_MAP: Record<string, KgTone> = {
  "#00D084": "positive",
  "#00A868": "positive",
  "#FFB800": "warning",
  "#D89400": "warning",
  "#B37F00": "warning",
  "#DC143C": "negative",
  "#F04060": "negative",
  "#B00D28": "negative",
};

export function toneOf(color: unknown): KgTone | null {
  if (typeof color !== "string") return null;
  return TONE_MAP[color.toUpperCase()] ?? null;
}
