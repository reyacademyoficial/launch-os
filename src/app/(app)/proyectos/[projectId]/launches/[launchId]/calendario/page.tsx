import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LaunchCalendarTable } from "@/components/dashboard/launches/launch-calendar-table";
import { tryComputeLaunchCalendar } from "@/lib/launches/calendar";
import { getLaunch } from "@/lib/launches/get";

export const metadata: Metadata = { title: "Calendario · Lanzamiento" };

export default async function LaunchCalendarPage({
  params,
}: {
  readonly params: Promise<{ projectId: string; launchId: string }>;
}) {
  const { projectId, launchId } = await params;
  const launch = await getLaunch(launchId);
  if (!launch || launch.project_id !== projectId) notFound();

  const calendar = tryComputeLaunchCalendar({
    launchDate: launch.launch_date ?? undefined,
    durCreacion: launch.dur_creacion,
    durNutricion: launch.dur_nutricion,
    durCaptacion: launch.dur_captacion,
    durCalentamiento: launch.dur_calentamiento,
    durCompra: launch.dur_compra,
    durCierre: launch.dur_cierre,
  });

  return (
    <section className="space-y-3">
      <header>
        <h2 className="text-base font-semibold text-fg">Calendario</h2>
        <p className="text-xs text-fg-subtle">
          Etapas derivadas de la fecha de lanzamiento + las 4 duraciones
          configurables en el form. La ventana total (date_start → date_end)
          es la que usa el sync engine.
        </p>
      </header>
      {calendar ? (
        <LaunchCalendarTable calendar={calendar} />
      ) : (
        <p className="rounded-md border border-dashed border-border bg-surface/40 p-4 text-center text-sm text-fg-muted">
          Sin fecha de lanzamiento cargada. Editá el launch para definirla y
          ver el calendario.
        </p>
      )}
    </section>
  );
}
