import {
  deleteDailyEntry,
  updateDailyEntry,
} from "@/app/(app)/(kg)/proyectos/[projectId]/launches/[launchId]/daily-actions";
import { KgDataTable, type Column } from "@/components/kg/data-table";
import { Panel } from "@/components/kg/panel";
import { fmtDate, fmtNumber } from "@/lib/format";
import {
  CHANNEL_LABELS,
  DAILY_CHANNELS,
  dailyTotal,
} from "@/lib/launch-daily/types";
import type { LaunchDailyRow } from "@/lib/launch-daily/types";

import { DailyDeleteButton } from "./daily-delete-button";
import { DailyFormModal } from "./daily-form-modal";

/**
 * Tabla de carga diaria por canal.
 *
 * La tabla HTML propia (thead/tbody con `bg-surface`, `border-border`,
 * `text-fg-subtle`) pasó a `KgDataTable`. Sigue siendo un SERVER component:
 * la primitiva no lleva "use client" justamente para casos como este, donde
 * las acciones se bindean en el server y sólo los botones son client.
 *
 * Las columnas de canal se siguen generando dinámicamente — `numeric: true`
 * les da `kg-num` + tabular-nums, que es lo que hacía el `tabular-nums` a
 * mano de antes.
 */
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

  const columns: Column<LaunchDailyRow>[] = [
    {
      key: "date",
      label: "Fecha",
      width: "150px",
      render: (row) => (
        <span style={{ whiteSpace: "nowrap", color: "var(--kg-text-2)" }}>
          {fmtDate(row.date)}
        </span>
      ),
    },
    ...activeChannels.map<Column<LaunchDailyRow>>((ch) => ({
      key: ch,
      label: CHANNEL_LABELS[ch],
      align: "right",
      numeric: true,
      render: (row) => (row[ch] === 0 ? "—" : fmtNumber(row[ch])),
    })),
    {
      key: "total",
      label: "Total",
      align: "right",
      numeric: true,
      render: (row) => (
        <strong style={{ fontWeight: 700 }}>{fmtNumber(dailyTotal(row))}</strong>
      ),
    },
  ];

  if (canEdit) {
    columns.push({
      key: "acciones",
      label: "",
      align: "right",
      width: "170px",
      render: (row) => (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            whiteSpace: "nowrap",
          }}
        >
          <DailyFormModal
            triggerLabel="Editar"
            triggerVariant="secondary"
            title={`Editar día — ${fmtDate(row.date)}`}
            submitLabel="Guardar"
            action={updateDailyEntry.bind(null, projectId, launchId, row.id)}
            initial={row}
          />
          <DailyDeleteButton
            onConfirm={deleteDailyEntry.bind(null, projectId, launchId, row.id)}
          />
        </div>
      ),
    });
  }

  // El `Panel pad={false}` reemplaza al `rounded-md border border-border` que
  // envolvía la tabla: la caja la trae el componente, igual que antes — los
  // dos call sites lo montan como bloque suelto, sin contenedor propio.
  return (
    <Panel pad={false}>
      <KgDataTable
        columns={columns}
        rows={sorted}
        rowKey={(row) => row.id}
        emptyTitle="Sin datos diarios cargados"
        emptyHint="Cargá un día a mano o configurá la integración para que la API los traiga sola."
      />
    </Panel>
  );
}
