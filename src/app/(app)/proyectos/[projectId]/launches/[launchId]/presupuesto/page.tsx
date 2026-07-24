import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  listBudgetCountriesForProject,
  listBudgetEntriesForLaunch,
} from "@/lib/budget/list";
import { BUDGET_STAGES, type BudgetStage } from "@/lib/budget/types";
import { getLaunch } from "@/lib/launches/get";
import { userCanEditLaunchesIn } from "@/lib/supabase/auth";

import { CountryManager } from "./country-manager";
import { CurrencyForm } from "./currency-form";
import { StageTable } from "./stage-table";

export const metadata: Metadata = { title: "Presupuesto · Lanzamiento" };

/**
 * Tab "Presupuesto" del detalle del launch. Carga manual por etapa y país
 * para planning de tráfico. Cinco tablas (una por etapa del calendario menos
 * compra/cierre): creación / nutrición / captación / calentamiento / consumo.
 *
 * Estado de la UI depende de si la moneda está seteada:
 *   - Sin moneda: se ve solo el CurrencyForm. Bloqueamos carga.
 *   - Con moneda: CurrencyForm + CountryManager + 5 tablas.
 *
 * Permisos:
 *   - SELECT: has_project_access (todos los miembros ven).
 *   - I/U/D: can_edit_launches_in (admin/operador). Cliente y analista lo
 *     ven read-only.
 */
export default async function LaunchPresupuestoPage({
  params,
}: {
  readonly params: Promise<{ projectId: string; launchId: string }>;
}) {
  const { projectId, launchId } = await params;

  const [launch, countries, entries, canEdit] = await Promise.all([
    getLaunch(launchId),
    listBudgetCountriesForProject(projectId),
    listBudgetEntriesForLaunch(launchId),
    userCanEditLaunchesIn(projectId),
  ]);

  if (!launch || launch.project_id !== projectId) notFound();

  // budget_currency es de la mig 0048 — puede no estar aún en el generated
  // Database type hasta regenerar. Casteamos puntualmente.
  const currency =
    (launch as unknown as { budget_currency: string | null }).budget_currency;

  const entriesByStage = new Map<BudgetStage, typeof entries>();
  for (const s of BUDGET_STAGES) entriesByStage.set(s, []);
  for (const e of entries) {
    const bucket = entriesByStage.get(e.stage);
    if (bucket) bucket.push(e);
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <header>
          <h2 className="text-base font-semibold text-fg">
            Presupuesto de lanzamiento
          </h2>
          <p className="text-xs text-fg-subtle">
            Cargá manualmente cuánto vas a presupuestar por país en cada etapa.
            El total por etapa es la suma de todos los países; el % es la
            participación de cada uno.
          </p>
        </header>
      </section>

      {canEdit ? (
        <CurrencyForm
          projectId={projectId}
          launchId={launchId}
          currentCurrency={currency}
        />
      ) : (
        currency && (
          <p className="rounded-md border border-border bg-surface p-4 text-sm text-fg-muted">
            Moneda: <strong className="text-fg">{currency}</strong>
          </p>
        )
      )}

      {!currency ? (
        <p className="rounded-md border border-border bg-surface p-4 text-sm text-fg-muted">
          {canEdit
            ? "Configurá la moneda antes de empezar a cargar presupuestos."
            : "Todavía no se configuró la moneda del presupuesto. Pedile al admin/operador que la asigne."}
        </p>
      ) : (
        <>
          {canEdit && (
            <CountryManager
              projectId={projectId}
              launchId={launchId}
              countries={countries}
            />
          )}

          <div className="space-y-4">
            {BUDGET_STAGES.map((stage) => (
              <StageTable
                key={stage}
                projectId={projectId}
                launchId={launchId}
                stage={stage}
                entries={entriesByStage.get(stage) ?? []}
                countries={countries}
                currency={currency}
                canEdit={canEdit}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
