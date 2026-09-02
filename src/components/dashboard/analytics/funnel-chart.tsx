import { KgFunnel } from "@/components/kg/funnel";
import { Panel } from "@/components/kg/panel";
import type { FunnelStage } from "@/lib/analytics/funnel";

/**
 * Embudo de 3 etapas del tab Embudo (Lead → Agendado → Vendido).
 *
 * ── Qué cambió al migrar al KG System ─────────────────────────────────────
 * Antes había DOS representaciones del mismo embudo, una arriba de la otra:
 * una grilla de 3 cards con el count y "X% del paso anterior", y debajo un
 * `BarChart` de recharts con 3 barras verticales. El lector tenía que saltar
 * entre las dos para armar la historia, y el chart no aportaba nada que las
 * cards no dijeran: tres categorías ordenadas no son una escala, y el dato
 * que importa —la conversión ENTRE pasos— recharts no lo puede dibujar (por
 * eso estaba en las cards).
 *
 * `KgFunnel` unifica las dos en una sola lectura: barras horizontales
 * apiladas de arriba hacia abajo (el orden de lectura ES el orden del
 * embudo), con el count y el % siempre visibles como direct labels y el
 * conector de conversión entre etapa y etapa, que es exactamente donde
 * ocurre. Las cards se BORRAN: lo que decían ya está en la barra (el count,
 * en 15px) y en el conector (la tasa contra el paso anterior). Duplicarlas
 * sería mostrar el mismo número dos veces.
 *
 * Bonus: el embudo pasa a ser HTML puro (divs con ancho porcentual), sin un
 * `ResponsiveContainer` + `BarChart` para dibujar tres rectángulos. Y a 390px
 * las etiquetas dejan de solaparse: en barras horizontales el label tiene
 * ancho de sobra, cosa que el eje X del BarChart no tenía.
 *
 * ── `rateOfPrev` NO se pasa, aunque `FunnelStage` lo traiga ───────────────
 * `KgFunnel` deriva la conversión de los counts. Es a propósito: mientras el
 * porcentaje venga por un canal y el número por otro, existe la posibilidad
 * de que discrepen (dos escalas — `getFunnelData` lo devuelve en 0-100 —,
 * dos redondeos, dos momentos de cálculo). Derivándolo, no pueden.
 *
 * El archivo deja de ser client: no queda ningún hook ni handler, y
 * `KgFunnel` recibe solo props serializables. La transformación se hace en
 * el server y al browser solo baja el embudo ya armado.
 */
export function FunnelChart({
  stages,
}: {
  readonly stages: ReadonlyArray<FunnelStage>;
}) {
  return (
    <Panel title="Embudo de conversión">
      <KgFunnel
        stages={stages.map((s) => ({
          key: s.key,
          label: s.label,
          count: s.count,
        }))}
        emptyTitle="Sin leads en el filtro actual"
        emptyHint="Ajustá el rango de fechas o los lanzamientos seleccionados para ver el embudo."
        footNote={
          <>
            &ldquo;Agendado&rdquo; incluye a los cerrados: el embudo es
            acumulativo, no de estados discretos. &ldquo;Vendido&rdquo; exige
            una venta cargada, no solo el lead en estado cerrado.
          </>
        }
      />
    </Panel>
  );
}
