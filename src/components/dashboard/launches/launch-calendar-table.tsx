import { fmtDate } from "@/lib/format";
import type { LaunchCalendar } from "@/lib/launches/calendar";

/**
 * Renders the 6-stage launch calendar. Stateless / server-renderable —
 * receives a precomputed `LaunchCalendar` (use `tryComputeLaunchCalendar`).
 *
 * Used in two places:
 *   - Live preview en el form de crear/editar launch.
 *   - Sección "Calendario" en el detalle del launch.
 */
export function LaunchCalendarTable({
  calendar,
}: {
  readonly calendar: LaunchCalendar;
}) {
  // Evergreen tiene una sola clase — clase2/clase3 llegan en null y se ocultan.
  const isEvergreen = calendar.consumo.clase2 === null;

  const rows: ReadonlyArray<{
    name: string;
    range: string;
    hint?: string;
  }> = [
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
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface text-left text-xs uppercase tracking-wide text-fg-subtle">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Etapa
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Fechas
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Nota
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name} className="border-t border-border">
                <td className="whitespace-nowrap px-3 py-2 font-medium text-fg">
                  {row.name}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-fg-muted">
                  {row.range}
                </td>
                <td className="px-3 py-2 text-xs text-fg-subtle">
                  {row.hint ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-fg-subtle">
        Ventana total del lanzamiento (date_start → date_end):{" "}
        <span className="font-medium text-fg">
          {fmtDate(calendar.windowStart)} → {fmtDate(calendar.windowEnd)}
        </span>
      </p>
    </div>
  );
}

function rangeLabel(start: string, end: string): string {
  return `${fmtDate(start)} → ${fmtDate(end)}`;
}
