"use client";

import { KgAreaChart } from "@/components/kg/area-chart";
import type {
  ConsumptionCells,
  ConsumptionConfig,
} from "@/lib/launch-consumption/types";
import { readCell } from "@/lib/launch-consumption/metrics";

/**
 * Chart comparativo del consumo por clase: X = hora, Y = asistentes, una
 * serie por clase configurada.
 *
 * Antes era un `LineChart` de recharts con paleta propia de 10 hexes y
 * tooltip a mano sobre los tokens viejos (`--color-border`,
 * `--color-fg-muted`). Ahora es `KgAreaChart`: la paleta categórica, la
 * leyenda con toggle, el tooltip y el chrome de ejes salen del design
 * system, y el tema claro/oscuro se resuelve por CSS var sin re-render.
 *
 * Va APILADO y no en líneas: la magnitud es acumulable a lo largo de la
 * ventana horaria, y apilado responde la pregunta que las líneas no
 * responden — cuánta gente hay EN TOTAL a esa hora. Es el caso que la
 * cabecera de `area-chart.tsx` describe como el que derivó su API.
 *
 * `hideEmptySeries` (default true) reemplaza al filtro `activeClasses` que
 * este archivo hacía a mano: una clase recién agregada sin datos no ensucia
 * la leyenda con una banda plana en cero.
 */

interface Props {
  readonly config: ConsumptionConfig;
  readonly cells: ConsumptionCells;
  readonly hourSlots: readonly string[];
}

export function ConsumptionChart({ config, cells, hourSlots }: Props) {
  // Cada punto = una hora, con un campo por clase.
  const data = hourSlots.map((hour) => {
    const point: Record<string, string | number> = { hour };
    for (const className of config.classes) {
      point[className] = readCell(cells, hour, className);
    }
    return point;
  });

  return (
    <KgAreaChart
      data={data}
      xKey="hour"
      stacked
      height={280}
      yLabel="Asistentes"
      allowDecimals={false}
      series={config.classes.map((c) => ({ key: c, label: c }))}
      // El chart cae al EmptyState cuando no hay ninguna serie con señal, así
      // que este texto cubre los dos motivos: config sin slots y grilla vacía.
      emptyTitle="Sin comparativa todavía"
      emptyHint="Hace falta una ventana horaria válida y al menos un asistente cargado en la grilla de arriba."
    />
  );
}
