"use client";

import { useMemo, useState } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { Panel } from "@/components/kg/panel";
import { fmtPercent } from "@/lib/format";
import {
  BUDGET_STAGE_LABELS,
  type BudgetCountryRow,
  type BudgetEntryRow,
  type BudgetStage,
} from "@/lib/budget/types";

import { EntryForm } from "./entry-form";
import { EntryActionsCell, EntryAmountCell, formatAmount } from "./entry-row";

/**
 * Tabla de una etapa: País | Monto | % del total | acciones. El % se
 * calcula relativo al total de ESTA etapa (no del launch). Al pie hay una
 * fila "Total" y — si canEdit y hay países no cargados todavía — un form
 * para agregar el próximo país.
 *
 * ── Por qué este archivo pasó a ser client ────────────────────────────────
 * Antes la fila editable era un `<tr>` propio (`EntryRow`) que se dibujaba
 * dentro de la tabla HTML de acá, así que el estado "esta fila está en
 * edición" podía vivir en la fila. `KgDataTable` es dueña de sus `<tr>`/`<td>`
 * y sólo llama al `render` de cada columna, con lo cual el estado tiene que
 * ser compartido entre DOS celdas (la de monto muestra el input, la de
 * acciones esconde los botones). La única forma de no partir el
 * comportamiento es subirlo acá: `editingId` es la fila abierta.
 *
 * Todas las props son datos planos, así que la page server la puede seguir
 * renderizando igual que antes.
 */
export function StageTable({
  projectId,
  launchId,
  stage,
  entries,
  countries,
  currency,
  canEdit,
}: {
  readonly projectId: string;
  readonly launchId: string;
  readonly stage: BudgetStage;
  readonly entries: ReadonlyArray<BudgetEntryRow>;
  readonly countries: ReadonlyArray<BudgetCountryRow>;
  readonly currency: string;
  readonly canEdit: boolean;
}) {
  // Fila abierta en edición inline. `null` = ninguna. Reemplaza al `editing`
  // que vivía dentro de cada `EntryRow`.
  const [editingId, setEditingId] = useState<string | null>(null);

  const countryById = useMemo(
    () => new Map(countries.map((c) => [c.id, c])),
    [countries],
  );

  // Orden estable: alfabético por país (independiente del orden de inserción).
  const sortedEntries = useMemo(
    () =>
      [...entries].sort((a, b) => {
        const na = countryById.get(a.country_id)?.name ?? "";
        const nb = countryById.get(b.country_id)?.name ?? "";
        return na.localeCompare(nb);
      }),
    [entries, countryById],
  );

  const total = sortedEntries.reduce((s, e) => s + e.amount, 0);
  const usedCountryIds = new Set(sortedEntries.map((e) => e.country_id));
  const availableCountries = countries.filter((c) => !usedCountryIds.has(c.id));
  const noCountriesAtAll = countries.length === 0;

  // Mutable a propósito: "Acciones" sólo existe con permiso de edición.
  const columns: Column<BudgetEntryRow>[] = [
    {
      key: "pais",
      label: "País",
      render: (e) => (
        <strong style={{ fontWeight: 600, color: "var(--kg-text-1)" }}>
          {countryById.get(e.country_id)?.name ?? "—"}
        </strong>
      ),
    },
    {
      key: "monto",
      label: "Presupuesto",
      align: "right",
      numeric: true,
      // El ancho lo fija la columna para que el input inline no ensanche la
      // tabla al abrir la edición (y la fila de totales quede alineada).
      width: canEdit ? "280px" : "160px",
      render: (e) =>
        canEdit ? (
          <EntryAmountCell
            projectId={projectId}
            launchId={launchId}
            entry={{
              id: e.id,
              stage: e.stage,
              country_id: e.country_id,
              amount: e.amount,
            }}
            currency={currency}
            editing={editingId === e.id}
            onDone={() => setEditingId(null)}
          />
        ) : (
          `${currency} ${formatAmount(e.amount)}`
        ),
    },
    {
      key: "pct",
      label: "% del total",
      align: "right",
      numeric: true,
      width: "110px",
      render: (e) => fmtPercent(total > 0 ? (e.amount / total) * 100 : 0),
    },
  ];

  if (canEdit) {
    columns.push({
      key: "acciones",
      label: "Acciones",
      align: "right",
      width: "150px",
      render: (e) =>
        editingId === e.id ? null : (
          <EntryActionsCell
            projectId={projectId}
            launchId={launchId}
            entryId={e.id}
            countryName={countryById.get(e.country_id)?.name ?? "—"}
            onEdit={() => setEditingId(e.id)}
          />
        ),
    });
  }

  return (
    <Panel
      title={BUDGET_STAGE_LABELS[stage]}
      pad={false}
      actions={
        <span className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
          Total{" "}
          <strong
            className="kg-num"
            style={{ color: "var(--kg-text-1)", fontSize: 12 }}
          >
            {currency} {formatAmount(total)}
          </strong>
        </span>
      }
    >
      <KgDataTable
        columns={columns}
        rows={sortedEntries}
        rowKey={(e) => e.id}
        emptyTitle={
          noCountriesAtAll
            ? "Todavía no hay países cargados"
            : "Sin presupuesto asignado en esta etapa"
        }
        emptyHint={
          noCountriesAtAll
            ? "Agregá un país en «Países del proyecto» para empezar a repartir el presupuesto."
            : canEdit
              ? "Elegí un país abajo y cargá el monto."
              : undefined
        }
        // `cells` va indexado por `Column.key`: el ancho y la alineación de
        // cada total salen de la columna, no se redeclaran acá.
        totalsRow={{
          label: "Total",
          cells: {
            monto: `${currency} ${formatAmount(total)}`,
            pct: "100.0%",
          },
        }}
      />

      {canEdit && availableCountries.length > 0 && (
        <EntryForm
          projectId={projectId}
          launchId={launchId}
          stage={stage}
          availableCountries={availableCountries}
        />
      )}
      {canEdit &&
        availableCountries.length === 0 &&
        !noCountriesAtAll &&
        sortedEntries.length > 0 && (
          <p
            className="kg-t6"
            style={{
              margin: 0,
              padding: "12px 20px",
              borderTop: "1px solid var(--kg-border-subtle)",
              color: "var(--kg-text-3)",
            }}
          >
            Todos los países del proyecto ya tienen presupuesto en esta etapa.
          </p>
        )}
    </Panel>
  );
}
