"use client";

import { useMemo } from "react";

import {
  KgComparator,
  type KgComparatorMetric,
} from "@/components/kg/comparator";
import { Panel } from "@/components/kg/panel";
import {
  fmtMoney,
  fmtMultiplier,
  fmtNumber,
  fmtPercentOrDash,
} from "@/lib/format";
import { calculateLaunchKPIs, type LaunchKPIs } from "@/lib/kpis";
import type { DailyAggregate } from "@/lib/launch-daily/aggregate";
import type { KanbanSalesAggregate } from "@/lib/launch-sales/aggregate";
import type { LaunchRow } from "@/lib/launches/types";

/**
 * Tab Comparador. Reusa `calculateLaunchKPIs` — los números son idénticos a
 * los de `kpi/page.tsx` del detalle del launch.
 *
 * ── Qué cambió al migrar al KG System ─────────────────────────────────────
 * Era una `<table className="min-w-[1200px]">` WIDE: una fila por launch, 12
 * columnas de KPI, scroll horizontal y sin columna sticky — a mitad del
 * scroll ya no sabías de qué lanzamiento era el número que estabas mirando.
 * Ahora es `KgComparator`, que es esa misma tabla TRANSPUESTA: fila =
 * métrica, columna = lanzamiento. Los dos valores que uno quiere comparar
 * ("¿cómo va el CPL de A contra el de B?") quedan uno al lado del otro en la
 * misma fila, y la columna de métrica es sticky.
 *
 * También se fue el semáforo: la celda de Profit se pintaba con
 * `text-success` / `text-error`. La regla del DS es que la plata no se pinta
 * (ver `tone.ts`); el estado viaja en el `StateDot` de "mejor de la fila" y
 * en la flecha del `Delta`, al lado del número, nunca encima.
 *
 * ── Por qué este archivo pasó a ser CLIENT ────────────────────────────────
 * `KgComparator` recibe `value` como ACCESSOR `(entityId, metricKey) =>
 * number | null` — a propósito, para no materializar 11 × N celdas cuando el
 * caller ya tiene un objeto de KPIs por launch. Una función no cruza el
 * boundary RSC, así que el componente que la construye tiene que ser client.
 *
 * Eso tiene un costo real y conviene decirlo: antes este archivo era server y
 * los `launches` + los dos Maps de agregados no salían del servidor; ahora
 * viajan en el payload RSC y `calculateLaunchKPIs` se ejecuta en el browser.
 * Se aceptó porque las cifras son chicas —los agregados son 13 y 5 números
 * por launch, y los launches del filtro son decenas, no miles— y porque
 * `calculateLaunchKPIs` es aritmética pura sin dependencias (no arrastra
 * nada más al bundle). Si algún día el proyecto tuviera cientos de
 * lanzamientos en un mismo filtro, la salida es mover el cálculo a la page y
 * pasar la matriz ya armada: `KgComparator` no cambia, cambia quién arma el
 * accessor. Los `useMemo` de acá son la mitad barata de eso.
 *
 * El `useMemo` calcula los KPIs UNA vez por launch; el accessor solo lee del
 * Map. Sin él, las 11 métricas × N lanzamientos dispararían 11 recálculos
 * completos por launch en cada render.
 */

/**
 * `null` es "no hay dato", nunca 0 — el contrato del `value` de
 * `KgComparator`. Los formatters de `@/lib/format` devuelven "$0" / "0" para
 * `null` (safeNumber cae a 0), así que se envuelven para que el hueco se vea
 * como hueco. Es la diferencia entre "el CPL fue cero" y "no hubo leads para
 * calcular un CPL".
 */
const fMoneyOrDash = (v: number | null | undefined): string =>
  v == null ? "—" : fmtMoney(v);
const fCountOrDash = (v: number | null | undefined): string =>
  v == null ? "—" : fmtNumber(v);
const fMultOrDash = (v: number | null | undefined): string =>
  v == null ? "—" : fmtMultiplier(v);

/**
 * Las mismas 12 columnas de la tabla vieja, en el mismo orden, ahora como
 * filas. Lo nuevo es `betterWhen`, que es la información que la tabla wide
 * no podía expresar: qué lado de cada métrica es el bueno.
 *
 *   · "none" en Inversión — invertir más no es ni mejor ni peor por sí solo;
 *     declarar una dirección sería inventar un juicio. Sin dirección no hay
 *     delta ni highlight, que es exactamente lo correcto.
 *   · "lower" en CPL — el único caso invertido del set. Ver la nota de abajo
 *     sobre cómo se lee su `Delta`.
 *   · "higher" en el resto.
 */
const METRICS: readonly KgComparatorMetric[] = [
  {
    key: "totalInvestment",
    label: "Inversión",
    format: fMoneyOrDash,
    betterWhen: "none",
  },
  {
    key: "totalLeads",
    label: "Leads",
    format: fCountOrDash,
    betterWhen: "higher",
  },
  {
    key: "cplAvg",
    label: "CPL promedio",
    format: fMoneyOrDash,
    betterWhen: "lower",
    hint: "Inversión / leads. Acá menos es mejor.",
  },
  {
    key: "showRate",
    label: "Show rate",
    format: fmtPercentOrDash,
    betterWhen: "higher",
    hint: "Asistentes C1 sobre inscriptos.",
  },
  {
    key: "closeRate",
    label: "Close rate",
    format: fmtPercentOrDash,
    betterWhen: "higher",
    hint: "Retención C1 → C3 (nombre histórico).",
  },
  {
    key: "ventas",
    label: "Ventas",
    format: fCountOrDash,
    betterWhen: "higher",
  },
  {
    key: "revenueEstimated",
    label: "Revenue est.",
    format: fMoneyOrDash,
    betterWhen: "higher",
    groupStart: "Resultado",
  },
  {
    key: "revenueCollected",
    label: "Revenue cobr.",
    format: fMoneyOrDash,
    betterWhen: "higher",
  },
  {
    key: "roasEstimated",
    label: "ROAS est.",
    format: fMultOrDash,
    betterWhen: "higher",
  },
  {
    key: "roasReal",
    label: "ROAS real",
    format: fMultOrDash,
    betterWhen: "higher",
  },
  {
    key: "profitEstimated",
    label: "Profit est.",
    format: fMoneyOrDash,
    betterWhen: "higher",
  },
];

const MONTHS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
] as const;

/**
 * `2026-06-05` → `jun 2026`, para la segunda línea del header de columna.
 * Se parsea el string a mano en vez de con `new Date()`: `date_start` es un
 * DATE de Postgres (sin zona) y construir un Date lo interpreta como UTC
 * medianoche, que en Buenos Aires cae el día anterior. El año NO se recorta
 * (a diferencia de `fDateShort`) porque un comparador cruza lanzamientos de
 * años distintos y "jun" solo sería ambiguo.
 */
function fMonthYear(ymd: string | null | undefined): string | undefined {
  if (!ymd) return undefined;
  const [year, month] = ymd.split("-");
  if (!year || !month) return undefined;
  const name = MONTHS[Number(month) - 1];
  return name ? `${name} ${year}` : year;
}

export function ComparatorTable({
  launches,
  adsByLaunch,
  kanbanSalesByLaunch,
}: {
  readonly launches: readonly LaunchRow[];
  readonly adsByLaunch: ReadonlyMap<string, DailyAggregate>;
  readonly kanbanSalesByLaunch: ReadonlyMap<string, KanbanSalesAggregate>;
}) {
  const kpis = useMemo(() => {
    const map = new Map<string, LaunchKPIs>();
    for (const l of launches) {
      map.set(
        l.id,
        calculateLaunchKPIs(l, {
          adsAggregate: adsByLaunch.get(l.id),
          kanbanSalesAggregate: kanbanSalesByLaunch.get(l.id),
        }),
      );
    }
    return map;
  }, [launches, adsByLaunch, kanbanSalesByLaunch]);

  const entities = useMemo(
    () =>
      launches.map((l) => ({
        id: l.id,
        label: l.name,
        sub: fMonthYear(l.date_start),
      })),
    [launches],
  );

  // `pad={false}` porque la grilla trae su propio padding de celdas y tiene
  // que llegar edge-to-edge para que el scroll horizontal empiece en el borde
  // del panel. El `paddingBottom` compensa lo único que eso deja mal: el
  // `footNote` de `KgComparator` solo tiene padding arriba, así que sin esto
  // el texto quedaría pegado al borde inferior de la tarjeta.
  return (
    <Panel
      pad={false}
      title="Comparador de lanzamientos"
      style={{ paddingBottom: 14 }}
    >
      <KgComparator
        entities={entities}
        metrics={METRICS}
        // La baseline por default es la PRIMERA entidad, y
        // `listLaunchesForProject` viene ordenado por `date_start` DESC: la
        // referencia es el lanzamiento más reciente, que es contra lo que uno
        // naturalmente compara ("¿este salió mejor que el anterior?").
        value={(entityId, metricKey) => {
          const k = kpis.get(entityId);
          if (!k) return null;
          if (metricKey === "cplAvg") {
            // Sin leads no hay CPL. `null` y no 0 — un cero se leería como
            // "los leads salieron gratis".
            return k.totalLeads > 0 ? k.totalInvestment / k.totalLeads : null;
          }
          const raw = (k as unknown as Record<string, unknown>)[metricKey];
          return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
        }}
        emptyTitle="Sin lanzamientos en el filtro actual"
        emptyHint="Ampliá el rango de fechas o sacá lanzamientos del filtro para comparar."
        footNote={
          <>
            La columna de referencia es el lanzamiento más reciente del filtro.
            En cada delta la <strong>flecha y el color</strong> dicen si el
            valor es mejor o peor que la referencia, y el{" "}
            <strong>signo del número</strong> dice la dirección aritmética. Por
            eso un CPL que bajó 8% se ve como &ldquo;▲ -8,1%&rdquo; en verde:
            bajó, y bajar es lo bueno. El punto verde marca el mejor valor de
            la fila.
          </>
        }
      />
    </Panel>
  );
}
