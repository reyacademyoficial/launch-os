import type { Metadata } from "next";
import Link from "next/link";

import { StatusBadge } from "@/components/dashboard/launches/status-badge";
import { fmtDate, fmtMoney, fmtMultiplier } from "@/lib/format";
import { calculateLaunchKPIs } from "@/lib/kpis";
import { listLaunchesForProject } from "@/lib/launches/list";
import { userCanEditProject } from "@/lib/supabase/auth";

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

  if (launches.length === 0) {
    return (
      <section className="max-w-md space-y-4">
        <h1 className="text-2xl font-bold">Lanzamientos</h1>
        <p className="text-sm text-fg-muted">
          Sin lanzamientos cargados todavía
          {canEdit ? "." : ". Pedile al admin del proyecto que cree el primero."}
        </p>
        {canEdit && (
          <Link
            href={`/proyectos/${projectId}/launches/new`}
            className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            Crear el primero
          </Link>
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
          <Link
            href={`/proyectos/${projectId}/launches/new`}
            className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            + Nuevo lanzamiento
          </Link>
        )}
      </header>

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-sm">
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
                  <td className="px-4 py-3 text-fg-muted">{fmtDate(l.date)}</td>
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
