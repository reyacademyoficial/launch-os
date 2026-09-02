import {
  deleteDailyEntry,
  updateDailyEntry,
} from "@/app/(app)/(kg)/proyectos/[projectId]/launches/[launchId]/daily-actions";
import { fmtDate, fmtNumber } from "@/lib/format";
import {
  CHANNEL_LABELS,
  DAILY_CHANNELS,
  dailyTotal,
} from "@/lib/launch-daily/types";
import type { LaunchDailyRow } from "@/lib/launch-daily/types";

import { DailyDeleteButton } from "./daily-delete-button";
import { DailyFormModal } from "./daily-form-modal";

export function DailyTable({
  rows,
  canEdit,
  projectId,
  launchId,
}: {
  readonly rows: readonly LaunchDailyRow[];
  readonly canEdit: boolean;
  readonly projectId: string;
  readonly launchId: string;
}) {
  // Sorted ascending in the helper for the chart; flip for table read order.
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date));

  // Solo mostramos columnas de canal que tengan al menos 1 valor > 0 en el
  // rango. Esto evita una tabla llena de "—" cuando el launch solo usa un
  // canal (ej. solo Meta). Si en algún momento se carga un día con otro
  // canal, la columna aparece sola sin tocar el componente.
  const activeChannels = DAILY_CHANNELS.filter((ch) =>
    rows.some((r) => r[ch] > 0),
  );

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[480px] text-sm">
        <thead className="bg-surface text-left text-xs uppercase tracking-wide text-fg-subtle">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Fecha
            </th>
            {activeChannels.map((ch) => (
              <th
                key={ch}
                scope="col"
                className="px-3 py-2 text-right font-medium"
              >
                {CHANNEL_LABELS[ch]}
              </th>
            ))}
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Total
            </th>
            {canEdit && <th scope="col" className="px-3 py-2" />}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const total = dailyTotal(row);
            const editAction = updateDailyEntry.bind(null, projectId, launchId, row.id);
            const deleteAction = deleteDailyEntry.bind(null, projectId, launchId, row.id);

            return (
              <tr
                key={row.id}
                className="border-t border-border transition-colors hover:bg-surface"
              >
                <td className="whitespace-nowrap px-3 py-2 text-fg-muted">
                  {fmtDate(row.date)}
                </td>
                {activeChannels.map((ch) => (
                  <td
                    key={ch}
                    className="px-3 py-2 text-right tabular-nums text-fg"
                  >
                    {row[ch] === 0 ? "—" : fmtNumber(row[ch])}
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-fg">
                  {fmtNumber(total)}
                </td>
                {canEdit && (
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <div className="inline-flex items-center gap-3">
                      <DailyFormModal
                        triggerLabel="Editar"
                        triggerVariant="secondary"
                        triggerClassName="!px-2 !py-1 !text-xs"
                        title={`Editar día — ${fmtDate(row.date)}`}
                        submitLabel="Guardar"
                        action={editAction}
                        initial={row}
                      />
                      <DailyDeleteButton onConfirm={deleteAction} />
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
