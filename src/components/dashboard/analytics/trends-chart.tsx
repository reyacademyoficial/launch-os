"use client";

import { KgLineChart } from "@/components/kg/line-chart";
import { Panel } from "@/components/kg/panel";
import { fmtMoney, fmtPercent } from "@/lib/format";

/**
 * Tick formatter compacto para el eje Y de moneda. Recharts solo pinta los
 * ticks en el ancho dado por `width`; si los strings son largos
 * ("$1,500,000") se cortan o solapan. Formato compacto deja "$1.5M" / "$120K"
 * — el tooltip sigue mostrando el monto completo con `fmtMoney`.
 */
function fmtMoneyCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

/**
 * Tendencias entre lanzamientos. Eje X = launches ordenados por `date_start`
 * ascendente (los más viejos a la izquierda). Los datos vienen
 * pre-calculados del server: la conversión launch → punto la hace el
 * `page.tsx` con `calculateLaunchKPIs`.
 */
export interface TrendsPoint {
  launchId: string;
  name: string;
  /** YYYY-MM-DD o null si el launch no tiene fecha. */
  dateStart: string | null;
  revenue: number;
  profit: number;
  cpl: number;
  closeRate: number;
}

/**
 * ═════════════════════════════════════════════════════════════════════════
 * EL DOBLE EJE Y SE PARTIÓ EN DOS CHARTS — y por qué esa y no la otra opción
 * ═════════════════════════════════════════════════════════════════════════
 * Antes esto era UN `LineChart` con dos escalas: `yAxisId="money"` a la
 * izquierda para Revenue/Profit/CPL y `yAxisId="pct"` a la derecha para el
 * close rate. Eso hace que el cruce entre la curva rosa y las de plata
 * PAREZCA significar algo ("el close rate superó al profit") cuando lo único
 * que lo produce es la elección de los dos rangos: mové un dominio y el
 * cruce se mueve con él. `KgLineChart` no expone `yAxisId` justamente por
 * eso (decisión 8 de su cabecera).
 *
 * Las dos salidas posibles eran partir en dos charts o indexar todo a una
 * base común (base 100 = primer lanzamiento). Se eligió PARTIR:
 *
 *   · Indexar destruye la magnitud, que acá es la mitad de la lectura. En
 *     este tab uno quiere ver "$180K de revenue" y "$14 de CPL", no
 *     "revenue 138, CPL 91". Un índice sirve cuando la pregunta es de forma
 *     relativa; ésta es de plata.
 *   · La base del índice sería el primer lanzamiento DEL FILTRO — o sea que
 *     cambiar el filtro repintaría todas las curvas sin que ningún dato haya
 *     cambiado. Una base que se mueve con el filtro es una trampa.
 *   · El close rate ya vive en otra unidad conceptual (una tasa, acotada a
 *     0-100) y en otra pregunta ("¿cómo retiene el webinar?"). Separarlo en
 *     su propio Panel no pierde nada: el eje X es el mismo y está alineado
 *     verticalmente, así que la comparación entre paneles se sigue haciendo
 *     con la mirada, sin el falso cruce.
 *
 * Revenue, Profit y CPL SÍ comparten un eje: están en la misma unidad
 * (pesos), que es la condición que hace legítima una escala compartida. Es
 * cierto que el CPL, dos o tres órdenes de magnitud más chico, queda
 * aplastado contra el piso — igual que antes, porque antes también compartía
 * el eje de moneda. La diferencia es que ahora hay salida: la leyenda de
 * `KgLineChart` permite apagar Revenue y Profit y el eje se re-escala solo
 * al rango del CPL. Eso lo dice el `footNote`.
 */
export function TrendsChart({
  points,
}: {
  readonly points: ReadonlyArray<TrendsPoint>;
}) {
  // Los dos charts comparten filas: mismo eje X, mismo orden. No se recorta
  // por cantidad — un solo lanzamiento en el filtro se dibuja como un punto.
  // Exigir 2 puntos (como hacía el guard viejo) es decirle "sin datos" a
  // alguien que sí los tiene. El vacío de verdad (cero filas) lo resuelve el
  // `EmptyState` de la propia primitiva.
  const data = points.map((p) => ({
    name: p.name,
    revenue: p.revenue,
    profit: p.profit,
    cpl: p.cpl,
    closeRate: p.closeRate,
  }));

  return (
    <div className="flex flex-col gap-5">
      <Panel title="Dinero por lanzamiento">
        <KgLineChart
          data={data}
          xKey="name"
          height={300}
          format={fmtMoney}
          yTickFormat={fmtMoneyCompact}
          series={[
            { key: "revenue", label: "Revenue" },
            { key: "profit", label: "Profit" },
            { key: "cpl", label: "CPL" },
          ]}
          emptyTitle="Sin lanzamientos en el filtro actual"
          emptyHint="Ampliá el rango de fechas o sacá lanzamientos del filtro para ver la evolución."
          footNote={
            <>
              Las tres series están en pesos y comparten escala. El CPL es de un
              orden de magnitud mucho menor, así que queda pegado al piso: tocá
              Revenue y Profit en la leyenda para apagarlas y el eje se
              re-escala solo al rango del CPL.
            </>
          }
        />
      </Panel>

      <Panel title="Retención del webinar (C1 → C3)">
        <KgLineChart
          data={data}
          xKey="name"
          height={220}
          // `closeRate` viene en escala 0-100 desde `calculateLaunchKPIs`,
          // que es lo que espera `fmtPercent` (NO `fPct`, que espera [0,1]).
          format={fmtPercent}
          yTickFormat={fmtPercent}
          allowDecimals
          series={[{ key: "closeRate", label: "Close rate" }]}
          emptyTitle="Sin retención cargada en el filtro"
          emptyHint="El close rate sale de los asistentes de Clase 1 y Clase 3. Cargalos en el detalle de cada lanzamiento para ver la curva."
          footNote={
            <>
              Un lanzamiento sin asistentes de Clase 1 cargados entra como 0%:
              el chart no puede plotear un hueco. El comparador sí los
              distingue con un &ldquo;—&rdquo;.
            </>
          }
        />
      </Panel>
    </div>
  );
}
