import { KgDataTable, type Column } from "@/components/kg/data-table";
import { Panel } from "@/components/kg/panel";
import { fmtDate } from "@/lib/format";
import type { LaunchCalendar } from "@/lib/launches/calendar";

/**
 * Renders the 6-stage launch calendar. Stateless / server-renderable —
 * receives a precomputed `LaunchCalendar` (use `tryComputeLaunchCalendar`).
 *
 * Used in two places:
 *   - Live preview en el form de crear/editar launch.
 *   - Sección "Calendario" en el detalle del launch.
 *
 * MIGRACIÓN KG
 * La `<table>` a mano (thead `bg-surface text-fg-subtle`, filas
 * `border-t border-border`, celdas `text-fg` / `text-fg-muted`) pasó a
 * `KgDataTable`. Se gana el chrome del DS —header en versalitas, hover de
 * fila, scroll horizontal propio en 390px— y se pierden ~35 LOC de markup.
 *
 * El `div.overflow-x-auto.rounded-md.border-border` que enmarcaba la tabla se
 * reemplaza por `Panel pad={false}`: mismo rol (caja con borde y esquinas),
 * pero con las vars `--kg-*`. Sin `title` porque los dos consumidores ya
 * ponen su propio encabezado encima ("Calendario", "Preview en vivo") — un
 * título acá sería el mismo texto dos veces.
 *
 * Sin `fillHeight`: son 6-8 filas fijas, la tabla nunca necesita llenar el
 * viewport ni scrollear en vertical. `fillHeight` acá clavaría la altura al
 * alto disponible y dejaría un hueco vacío debajo de las etapas.
 *
 * El `<p>` con la ventana total dejó de ser un párrafo suelto debajo: ahora
 * viaja en `footerActions`, o sea en la misma barra donde `KgDataTable`
 * cuenta las filas. Es metadata de la tabla, no del bloque.
 *
 * NO se marca `"use client"` a propósito: `KgDataTable` no tiene hooks y este
 * componente lo consumen tanto una page SERVER (`calendario/page.tsx`) como
 * dos árboles client (`launch-form.tsx`, `calculator/calendar-section.tsx`).
 * Las `render` de las columnas se definen y se ejecutan del mismo lado —
 * nunca cruzan el boundary RSC.
 */

/** Fila de una etapa del calendario. Shape local, solo de presentación. */
interface StageRow {
  readonly name: string;
  readonly range: string;
  readonly hint?: string;
}

const COLUMNS: ReadonlyArray<Column<StageRow>> = [
  {
    key: "name",
    label: "Etapa",
    render: (r) => (
      <span style={{ fontWeight: 600, color: "var(--kg-text-1)" }}>
        {r.name}
      </span>
    ),
  },
  {
    key: "range",
    label: "Fechas",
    // `kg-num` + tabular-nums: las fechas tienen que alinear dígito con
    // dígito para que la progresión de etapas se lea en vertical de un
    // vistazo. Se dejan a la izquierda —no son magnitudes, son etiquetas—
    // así que `numeric` va sin `align: "right"`.
    numeric: true,
    render: (r) => (
      <span style={{ color: "var(--kg-text-2)" }}>{r.range}</span>
    ),
  },
  {
    key: "hint",
    label: "Nota",
    render: (r) => (
      <span
        style={{
          // Las celdas de `KgDataTable` van `nowrap` (pensadas para montos);
          // acá la nota es prosa y tiene que envolver, si no la tabla se
          // estira a 900px y obliga a scrollear en desktop.
          whiteSpace: "normal",
          display: "inline-block",
          maxWidth: 320,
          fontSize: 11.5,
          lineHeight: 1.4,
          color: "var(--kg-text-3)",
        }}
      >
        {r.hint ?? "—"}
      </span>
    ),
  },
];

export function LaunchCalendarTable({
  calendar,
}: {
  readonly calendar: LaunchCalendar;
}) {
  // Evergreen tiene una sola clase — clase2/clase3 llegan en null y se ocultan.
  const isEvergreen = calendar.consumo.clase2 === null;

  const rows: ReadonlyArray<StageRow> = [
    {
      name: "Creación",
      range: rangeLabel(calendar.creacion.startDate, calendar.creacion.endDate),
      hint: "Producción de contenido — termina cuando arranca captación",
    },
    {
      name: "Nutrición",
      range: rangeLabel(
        calendar.nutricion.startDate,
        calendar.nutricion.endDate,
      ),
      hint: "Convive con creación, arranca más cerca de captación",
    },
    {
      name: "Captación",
      range: rangeLabel(calendar.captacion.startDate, calendar.captacion.endDate),
      hint: "Tráfico pago a leads",
    },
    {
      name: "Calentamiento",
      range: rangeLabel(
        calendar.calentamiento.startDate,
        calendar.calentamiento.endDate,
      ),
      hint: "Convive con captación, arranca más cerca de la Clase 1",
    },
    isEvergreen
      ? {
          name: "Consumo · Clase única",
          range: fmtDate(calendar.consumo.clase1),
          hint: "Evergreen — abre el carrito el mismo día",
        }
      : {
          name: "Consumo · Clase 1",
          range: fmtDate(calendar.consumo.clase1),
        },
    ...(isEvergreen
      ? []
      : [
          {
            name: "Consumo · Clase 2",
            range: fmtDate(calendar.consumo.clase2!),
          },
          {
            name: "Consumo · Clase 3",
            range: fmtDate(calendar.consumo.clase3!),
            hint: "Abre el carrito",
          },
        ]),
    {
      name: "Compra",
      range: rangeLabel(calendar.compra.startDate, calendar.compra.endDate),
    },
    {
      name: "Cierre",
      range: rangeLabel(calendar.cierre.startDate, calendar.cierre.endDate),
      hint: "Rezagados — contiguo a compra",
    },
  ];

  return (
    <Panel pad={false}>
      <KgDataTable
        columns={COLUMNS}
        rows={rows}
        rowKey={(r) => r.name}
        emptyTitle="Sin etapas calculadas"
        emptyHint="Cargá la fecha de lanzamiento y las duraciones para ver el calendario."
        footerActions={
          <span style={{ color: "var(--kg-text-3)" }}>
            Ventana total (date_start → date_end):{" "}
            <strong
              className="kg-num"
              style={{ color: "var(--kg-text-2)", fontWeight: 600 }}
            >
              {fmtDate(calendar.windowStart)} → {fmtDate(calendar.windowEnd)}
            </strong>
          </span>
        }
      />
    </Panel>
  );
}

function rangeLabel(start: string, end: string): string {
  return `${fmtDate(start)} → ${fmtDate(end)}`;
}
