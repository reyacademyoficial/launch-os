import type { Metadata } from "next";
import Link from "next/link";

import { LaunchFormModal } from "@/components/dashboard/launches/launch-form-modal";
import { ContextBar } from "@/components/kg/context-bar";
import { KgDataTable, type Column } from "@/components/kg/data-table";
import { EmptyState } from "@/components/kg/empty-state";
import { IconLaunch } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { StateDot } from "@/components/kg/state-dot";
import { StatusPill } from "@/components/kg/status-pill";
import type { KgTone } from "@/components/kg/tone";
import {
  fmtLaunchWindow,
  fmtMoney,
  fmtMultiplier,
  fmtNumber,
} from "@/lib/format";
import { calculateLaunchKPIs } from "@/lib/kpis";
import { listAggregatesForProject } from "@/lib/launch-daily/list";
import {
  getKanbanSalesAggregatesForProject,
  getProjectRevenueUsdMap,
} from "@/lib/launch-sales/list";
import { launchStatusTone } from "@/lib/launches/status-tone";
import type { LaunchStatus } from "@/lib/launches/types";
import { listLaunchesForProject } from "@/lib/launches/list";
import {
  fmtUsd,
  loadProjectFxRates,
  resolveLaunchFallbackRate,
} from "@/lib/money";
import { listBanks } from "@/lib/banks/list";
import { listPaymentMethods } from "@/lib/payment-methods/list";
import {
  denyCloserOutsideVentas,
  requireSessionProfile,
  userCanEditLaunchesIn,
} from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

import { createLaunch } from "./actions";

export const metadata: Metadata = { title: "Lanzamientos" };

/**
 * Fila ya resuelta del listado. Los KPIs se calculan en el server (necesitan
 * los mapas de FX y de agregados que trae esta page) y llegan a la columna
 * YA FORMATEADOS: el formateador depende del FX de cada lanzamiento, así que
 * no se puede elegir uno solo para toda la tabla. Mismo criterio que la tabla
 * "Últimos lanzamientos" del Overview.
 */
interface LaunchRowData {
  readonly id: string;
  readonly name: string;
  readonly window: string;
  readonly status: LaunchStatus | string | null;
  readonly revenueEstimated: string;
  readonly revenueCollected: string;
  readonly roasEstimated: string;
  readonly profitEstimated: string;
  /** Signo del profit — alimenta el StateDot, NO el color del número. */
  readonly profitTone: KgTone | null;
}

export default async function LaunchesPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const profile = await requireSessionProfile();
  denyCloserOutsideVentas(profile, projectId);

  const supabase = await createClient();
  const [
    launches,
    canEdit,
    adsAggregates,
    kanbanSalesAggregates,
    paymentMethods,
    banks,
    fxMap,
  ] = await Promise.all([
    listLaunchesForProject(projectId),
    userCanEditLaunchesIn(projectId),
    listAggregatesForProject(projectId),
    getKanbanSalesAggregatesForProject(projectId),
    listPaymentMethods(),
    listBanks(),
    loadProjectFxRates(supabase, projectId),
  ]);

  const hideRevenue = profile.role === "operador";

  const launchesForFx = launches.map((l) => {
    const row = l as unknown as {
      ars_per_usd?: number | null;
      date_start?: string | null;
      date_end?: string | null;
    };
    return {
      id: l.id,
      ars_per_usd: row.ars_per_usd ?? null,
      date_start: row.date_start ?? null,
      date_end: row.date_end ?? null,
    };
  });
  const revenueUsdMap = await getProjectRevenueUsdMap(
    projectId,
    launchesForFx,
    fxMap,
    paymentMethods as unknown as Array<{
      id: string;
      bank_id: string | null;
      currency: "ARS" | "USD" | null;
    }>,
    banks as unknown as Array<{ id: string; currency: "ARS" | "USD" }>,
  );

  const createAction = createLaunch.bind(null, projectId);
  // El select "Copiar conexiones de" en el modal de crear listea launches
  // existentes del mismo proyecto. Se reusan los datos que ya pedimos arriba.
  const copyableLaunches = launches.map((l) => ({ id: l.id, name: l.name }));

  // Recuentos por status para la barra de contexto. Se derivan del mismo
  // `launches` que ya alimenta la tabla — sin ida extra a la base.
  // Los montos (revenue / profit) quedan fuera a propósito: cada launch se
  // muestra en su propia moneda según la tasa que resuelva, así que un total
  // sumado acá sería un número mezclado. El agregado en moneda única vive en
  // el Overview, que sí pasa por `aggregateProjectKPIs`.
  const activos = launches.filter((l) => l.status === "Activo").length;
  const finalizados = launches.filter((l) => l.status === "Finalizado").length;

  const rows: readonly LaunchRowData[] = launches.map((l) => {
    const launchRow = l as unknown as {
      ars_per_usd?: number | null;
      ads_currency?: string;
      date_start?: string | null;
      date_end?: string | null;
    };
    const revenueRate = resolveLaunchFallbackRate(launchRow, fxMap);
    const usdRevenue = revenueUsdMap.get(l.id);

    const kpi = calculateLaunchKPIs(l, {
      adsAggregate: adsAggregates.get(l.id),
      kanbanSalesAggregate: kanbanSalesAggregates.get(l.id),
      adsRatePerUsd:
        launchRow.ads_currency === "ARS" && revenueRate ? revenueRate : null,
      kanbanPledgedUsd: usdRevenue?.pledgedUsd ?? null,
      kanbanCollectedUsd: usdRevenue?.collectedUsd ?? null,
      revenueRatePerUsd: revenueRate,
    });

    // Mostrar en USD si CUALQUIER camino de conversión funcionó:
    // - hay tasa efectiva del launch (propia o monthly), o
    // - el kanban devolvió montos USD válidos (via saleToUsd /
    //   paymentToUsd, que ya aplican fallback interno launch→monthly
    //   y respetan sale.currency='USD' nativo sin necesitar tasa).
    // Antes: `revenueRate ? fmtUsd : fmtMoney` — una venta USD nativa
    // en un launch sin tasa se mostraba como pesos crudos ("500")
    // aunque el kpi.revenueEstimated ya viniera en USD.
    const hasUsdRevenue =
      (usdRevenue?.pledgedUsd ?? 0) > 0 || (usdRevenue?.collectedUsd ?? 0) > 0;
    const fMoney = revenueRate || hasUsdRevenue ? fmtUsd : fmtMoney;

    return {
      id: l.id,
      name: l.name,
      window: fmtLaunchWindow(l.date_start, l.date_end),
      status: l.status,
      revenueEstimated: fMoney(kpi.revenueEstimated),
      revenueCollected: fMoney(kpi.revenueCollected),
      roasEstimated: fmtMultiplier(kpi.roasEstimated),
      profitEstimated: fMoney(kpi.profitEstimated),
      // El `text-success`/`text-error` sobre el monto se va: la plata no se
      // pinta. El signo viaja en un StateDot al lado del número.
      profitTone:
        kpi.profitEstimated > 0
          ? "positive"
          : kpi.profitEstimated < 0
            ? "negative"
            : null,
    };
  });

  const columns: ReadonlyArray<Column<LaunchRowData>> = [
    {
      key: "name",
      label: "Lanzamiento",
      render: (r) => (
        <Link
          href={`/proyectos/${projectId}/launches/${r.id}`}
          className="kg-focus"
          style={{
            color: "var(--kg-text-1)",
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          {r.name}
        </Link>
      ),
    },
    {
      key: "window",
      label: "Fecha",
      width: "230px",
      render: (r) => (
        <span style={{ color: "var(--kg-text-3)" }}>{r.window}</span>
      ),
    },
    {
      key: "status",
      label: "Status",
      width: "140px",
      render: (r) => (
        <StatusPill text={r.status} tone={launchStatusTone(r.status)} />
      ),
    },
    // Bloque de plata: el operador no lo ve (regla 2026-08-08). Las columnas
    // ni se emiten, así la tabla no queda con huecos.
    ...(hideRevenue
      ? []
      : ([
          {
            key: "revenueEstimated",
            label: "Revenue est.",
            align: "right",
            numeric: true,
            width: "140px",
            render: (r) => r.revenueEstimated,
          },
          {
            key: "revenueCollected",
            label: "Revenue cobr.",
            align: "right",
            numeric: true,
            width: "140px",
            render: (r) => r.revenueCollected,
          },
          {
            key: "roasEstimated",
            label: "ROAS est.",
            align: "right",
            numeric: true,
            width: "110px",
            render: (r) => (
              <span style={{ color: "var(--kg-text-3)" }}>
                {r.roasEstimated}
              </span>
            ),
          },
          {
            key: "profitEstimated",
            label: "Profit est.",
            align: "right",
            numeric: true,
            width: "150px",
            render: (r) => (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  justifyContent: "flex-end",
                }}
              >
                {r.profitEstimated}
                <StateDot tone={r.profitTone} size={4} />
              </span>
            ),
          },
        ] satisfies ReadonlyArray<Column<LaunchRowData>>)),
  ];

  // El botón de crear vive en las `actions` del Panel — antes colgaba solo en
  // una fila `justify-end` propia, que sumaba una franja de aire entre el
  // ContextBar y la tabla sin decir nada.
  const newLaunchButton = canEdit ? (
    <LaunchFormModal
      triggerLabel="+ Nuevo lanzamiento"
      title="Nuevo lanzamiento"
      submitLabel="Crear lanzamiento"
      action={createAction}
      copyableLaunches={copyableLaunches}
      recycleTargetOptions={copyableLaunches}
    />
  ) : null;

  return (
    // `h-full min-h-0` porque el Panel y la tabla van en `fillHeight`: la
    // tabla llena el viewport y scrollea adentro, como en `audit/page.tsx`.
    <div className="flex h-full min-h-0 flex-col gap-5">
      <ContextBar
        icon={<IconLaunch size={16} />}
        title="Lanzamientos"
        stats={[
          { l: "Total", v: fmtNumber(launches.length) },
          { l: "Activos", v: fmtNumber(activos) },
          { l: "Finalizados", v: fmtNumber(finalizados) },
        ]}
      />

      <Panel
        title="Lanzamientos"
        pad={false}
        fillHeight
        actions={newLaunchButton}
      >
        {launches.length === 0 ? (
          // El vacío se trata como onboarding, no como "sin datos": el
          // `EmptyState` propio lleva el CTA de crear. `KgDataTable` también
          // renderea un EmptyState cuando no hay filas, pero sin acciones —
          // por eso acá lo montamos a mano.
          <EmptyState
            icon={<IconLaunch size={18} />}
            title="Sin lanzamientos todavía"
            hint={
              canEdit
                ? "Creá el primero para empezar a cargar inversión, leads y ventas."
                : "Pedile al admin del proyecto que cree el primero."
            }
            actions={newLaunchButton}
          />
        ) : (
          <KgDataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            fillHeight
            emptyTitle="Sin lanzamientos todavía"
          />
        )}
      </Panel>
    </div>
  );
}
