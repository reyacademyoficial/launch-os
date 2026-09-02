import { fmtPercent } from "@/lib/format";
import {
  BUDGET_STAGE_LABELS,
  type BudgetCountryRow,
  type BudgetEntryRow,
  type BudgetStage,
} from "@/lib/budget/types";

import { EntryForm } from "./entry-form";
import { EntryRow } from "./entry-row";

/**
 * Tabla de una etapa: País | Monto | % del total | acciones. El % se
 * calcula relativo al total de ESTA etapa (no del launch). Al pie hay una
 * fila "Total" y — si canEdit y hay países no cargados todavía — un form
 * para agregar el próximo país.
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
  const countryById = new Map(countries.map((c) => [c.id, c]));
  // Orden estable: alfabético por país (independiente del orden de inserción).
  const sortedEntries = [...entries].sort((a, b) => {
    const na = countryById.get(a.country_id)?.name ?? "";
    const nb = countryById.get(b.country_id)?.name ?? "";
    return na.localeCompare(nb);
  });

  const total = sortedEntries.reduce((s, e) => s + e.amount, 0);
  const usedCountryIds = new Set(sortedEntries.map((e) => e.country_id));
  const availableCountries = countries.filter((c) => !usedCountryIds.has(c.id));
  const noCountriesAtAll = countries.length === 0;

  return (
    <section className="space-y-2 rounded-md border border-border bg-surface">
      <header className="flex items-baseline justify-between px-4 pt-4">
        <h3 className="text-sm font-semibold text-fg">
          {BUDGET_STAGE_LABELS[stage]}
        </h3>
        <span className="text-xs text-fg-subtle">
          Total: <strong className="text-fg">{currency} {formatAmount(total)}</strong>
        </span>
      </header>

      {sortedEntries.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-fg-muted">
          {noCountriesAtAll
            ? "Agregá un país en la sección de arriba para empezar."
            : "Sin presupuesto asignado en esta etapa."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-bg-elevated text-left text-xs uppercase tracking-wide text-fg-subtle">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  País
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Presupuesto
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  % del total
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  {canEdit ? "Acciones" : ""}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedEntries.map((e) => {
                const country = countryById.get(e.country_id);
                if (!country) return null;
                if (canEdit) {
                  return (
                    <EntryRow
                      key={e.id}
                      projectId={projectId}
                      launchId={launchId}
                      entry={{
                        id: e.id,
                        stage: e.stage,
                        country_id: e.country_id,
                        amount: e.amount,
                      }}
                      countryName={country.name}
                      currency={currency}
                      total={total}
                    />
                  );
                }
                const percent = total > 0 ? (e.amount / total) * 100 : 0;
                return (
                  <tr
                    key={e.id}
                    className="border-t border-border"
                  >
                    <td className="px-4 py-2 font-medium text-fg">
                      {country.name}
                    </td>
                    <td className="px-4 py-2 text-right text-fg-muted">
                      {currency} {formatAmount(e.amount)}
                    </td>
                    <td className="px-4 py-2 text-right text-fg-muted">
                      {fmtPercent(percent)}
                    </td>
                    <td />
                  </tr>
                );
              })}
              <tr className="border-t border-border bg-bg-elevated font-semibold">
                <td className="px-4 py-2 text-fg">Total</td>
                <td className="px-4 py-2 text-right text-fg">
                  {currency} {formatAmount(total)}
                </td>
                <td className="px-4 py-2 text-right text-fg">100.0%</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}

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
          <p className="px-4 pb-4 text-xs text-fg-subtle">
            Todos los países del proyecto ya tienen presupuesto en esta etapa.
          </p>
        )}
    </section>
  );
}

function formatAmount(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
