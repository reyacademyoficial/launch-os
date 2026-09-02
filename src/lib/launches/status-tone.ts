import type { LaunchStatus } from "./types";

/**
 * Tono KG para el status de un lanzamiento.
 *
 * Reemplaza al `STATUS_VARIANT` del viejo `StatusBadge`, que devolvía
 * variantes del `Badge` legacy (`success` / `warning` / `info` / `neutral`).
 * Acá devolvemos directamente la CSS var que consume `StatusPill` como
 * `tone`, así el color sale del design system y respeta claro/oscuro.
 *
 * Vive en `lib/launches` y no en `components/kg` porque es vocabulario del
 * dominio Lanzamientos, no una primitiva del design system: la tabla del
 * overview, el listado y el header del launch lo comparten.
 */
const TONE_BY_STATUS: Record<LaunchStatus, string> = {
  Activo: "var(--kg-positive-500)",
  Escalando: "var(--kg-warning-500)",
  Evergreen: "var(--kg-accent-500)",
  Finalizado: "var(--kg-neutral-500)",
};

export function launchStatusTone(
  status: LaunchStatus | string | null | undefined,
): string {
  if (!status) return "var(--kg-neutral-500)";
  return TONE_BY_STATUS[status as LaunchStatus] ?? "var(--kg-neutral-500)";
}
