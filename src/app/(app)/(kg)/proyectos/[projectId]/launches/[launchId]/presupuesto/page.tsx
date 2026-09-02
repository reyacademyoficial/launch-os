import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ContextBar } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import { IconLaunch } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import {
  listBudgetCountriesForProject,
  listBudgetEntriesForLaunch,
} from "@/lib/budget/list";
import { BUDGET_STAGES, type BudgetStage } from "@/lib/budget/types";
import { fmtNumber } from "@/lib/format";
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
 *   - I/U/D: can_edit_launches_in (admin/operador). Cliente y coordinador lo
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

  // Totales para la barra: las tablas ya muestran el total POR etapa, así que
  // acá interesa el global y cuántas etapas tienen algo cargado (el resto
  // sigue en cero y es lo que falta planificar).
  const totalBudget = entries.reduce((sum, e) => sum + e.amount, 0);
  const stagesWithBudget = BUDGET_STAGES.filter(
    (s) => (entriesByStage.get(s) ?? []).length > 0,
  ).length;

  return (
    <div className="flex flex-col gap-5">
      <ContextBar
        icon={<IconLaunch size={16} />}
        title="Presupuesto"
        stats={[
          {
            l: "Total presupuestado",
            // El monto no es USD necesariamente: prefijamos el código de
            // moneda del launch como hacen las tablas de cada etapa.
            v: currency ? `${currency} ${fmtNumber(totalBudget)}` : "—",
          },
          {
            l: "Etapas cargadas",
            v: `${fmtNumber(stagesWithBudget)} de ${BUDGET_STAGES.length}`,
          },
          { l: "Países", v: fmtNumber(countries.length) },
          {
            l: "Moneda",
            v: currency ?? "Sin definir",
            // Sin moneda la carga está bloqueada — es el gate de toda la tab.
            c: currency ? undefined : "#FFB800",
          },
        ]}
      />

      {/*
        La moneda es el gate de la tab. Con permiso de edición se muestra el
        form; sin permiso, sólo el dato — antes era un <p> con borde propio
        (tokens viejos), ahora es un Panel como cualquier otro bloque.
      */}
      {canEdit ? (
        <CurrencyForm
          projectId={projectId}
          launchId={launchId}
          currentCurrency={currency}
        />
      ) : (
        currency && (
          <Panel title="Moneda del lanzamiento">
            <div className="kg-t6" style={{ color: "var(--kg-text-3)" }}>
              Los montos de este lanzamiento se cargan en{" "}
              <strong style={{ color: "var(--kg-text-1)", fontWeight: 700 }}>
                {currency}
              </strong>
              .
            </div>
          </Panel>
        )
      )}

      {!currency ? (
        // Vacío como onboarding, no como error: sin moneda no hay nada que
        // cargar todavía, y el hint dice quién destraba el paso.
        <Panel title="Presupuesto de lanzamiento" pad={false}>
          <EmptyState
            icon={<IconLaunch size={18} />}
            title="Falta definir la moneda"
            hint={
              canEdit
                ? "Configurá la moneda del lanzamiento acá arriba para empezar a cargar presupuestos por país y etapa."
                : "Todavía no se configuró la moneda del presupuesto. Pedile al admin u operador del proyecto que la asigne."
            }
          />
        </Panel>
      ) : (
        <>
          {canEdit && (
            <CountryManager
              projectId={projectId}
              launchId={launchId}
              countries={countries}
            />
          )}

          {/*
            La explicación de las cinco tablas vive como lead-in de la lista y
            no como Panel propio: un Panel que sólo contiene prosa pesa igual
            que uno con datos y desordena la jerarquía.
          */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p
              className="kg-t6"
              style={{ margin: 0, color: "var(--kg-text-3)", maxWidth: 720 }}
            >
              Cargá manualmente cuánto vas a presupuestar por país en cada
              etapa. El total por etapa es la suma de todos los países; el % es
              la participación de cada uno.
            </p>

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
