import { StatusPill } from "@/components/kg/status-pill";
import { launchStatusTone } from "@/lib/launches/status-tone";
import type { LaunchStatus } from "@/lib/launches/types";

/**
 * Status de un lanzamiento.
 *
 * Los internos migraron al design system KG: por dentro ya es un `StatusPill`
 * (dot de color + texto neutro) coloreado con `launchStatusTone`, en vez del
 * `Badge` legacy con fondo tintado. El fondo de color se va a propósito —
 * cuando aparecen varios badges seguidos en una tabla el efecto semáforo tapa
 * el dato; el color queda reducido al dot.
 *
 * El NOMBRE y los PROPS se mantienen intactos porque este componente lo
 * consumen también 3 páginas del portal de cliente
 * (`src/app/(cliente)/portal/proyectos/**`), que no se tocan en esta
 * migración. Así el look KG se hereda sin cambiar un solo call site.
 *
 * En código NUEVO usar `StatusPill` + `launchStatusTone` directo — este
 * wrapper existe sólo por los call sites que ya estaban.
 */
export function StatusBadge({
  status,
}: {
  readonly status: LaunchStatus | string | null;
}) {
  // `StatusPill` ya resuelve el caso vacío con un guion en gris, así que no
  // hace falta el early-return que tenía la versión con `Badge`.
  return <StatusPill text={status} tone={launchStatusTone(status)} />;
}
