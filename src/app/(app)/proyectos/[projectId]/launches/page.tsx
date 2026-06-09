import type { Metadata } from "next";
import Link from "next/link";

import { LaunchFormModal } from "@/components/dashboard/launches/launch-form-modal";
import { StatusBadge } from "@/components/dashboard/launches/status-badge";
import { fmtLaunchWindow, fmtMoney, fmtMultiplier } from "@/lib/format";
import { calculateLaunchKPIs } from "@/lib/kpis";
import { listLaunchesForProject } from "@/lib/launches/list";
import { userCanEditProject } from "@/lib/supabase/auth";

import { createLaunch } from "./actions";

export const metadata: Metadata = { title: "Lanzamientos" };

export default async function LaunchesPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const [launches, canEdit] = await Promise.all([
    listLaunchesForProject(projectId),
    userCanEditProject(projectId),
  ]);

  const createAction = createLaunch.bind(null, projectId);

  if (launches.length === 0) {
    return (
      <section className="max-w-md space-y-4">
        <h1 className="text-2xl font-bold">Lanzamientos</h1>
        <p className="text-sm text-fg-muted">
          Sin lanzamientos cargados todavía
          {canEdit ? "." : ". Pedile al admin del proyecto que cree el primero."}
        </p>
        {canEdit && (
          <LaunchFormModal
            triggerLabel="Crear el primero"
            title="Nuevo lanzamiento"
            submitLabel="Crear lanzamiento"
            action={createAction}
          />
        )}
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Lanzamientos</h1>
          <p className="mt-1 text-xs text-fg-subtle">{launches.length} total</p>
        </div>
        {canEdit && (
          <LaunchFormModal
            triggerLabel="+ Nuevo lanzamiento"
            title="Nuevo lanzamiento"
            submitLabel="Crear lanzamiento"
            action={createAction}
          />
        )}
      </header>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-surface text-left text-xs uppercase tracking-wide text-fg-subtle">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                Nombre
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Fecha
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Status
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                Revenue
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                ROAS
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                Profit
              </th>
            </tr>
          </thead>
          <tbody>
            {launches.map((l) => {
              const kpi = calculateLaunchKPIs(l);
              const profitColor =
                kpi.profit > 0
                  ? "text-success"
                  : kpi.profit < 0
                    ? "text-error"
                    : "text-fg";
              return (
                <tr
                  key={l.id}
                  className="border-t border-border transition-colors hover:bg-surface"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/proyectos/${projectId}/launches/${l.id}`}
                      className="font-medium text-fg hover:text-accent"
                    >
                      {l.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-fg-muted">
                    {fmtLaunchWindow(l.date_start, l.date_end)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={l.status} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-fg">
                    {fmtMoney(kpi.revenue)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-fg-muted">
                    {fmtMultiplier(kpi.roas)}
                  </td>
                  <td className={`px-4 py-3 text-right tabular-nums ${profitColor}`}>
                    {fmtMoney(kpi.profit)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
