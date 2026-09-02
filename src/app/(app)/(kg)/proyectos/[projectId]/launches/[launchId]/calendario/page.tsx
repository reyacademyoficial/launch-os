import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LaunchCalendarTable } from "@/components/dashboard/launches/launch-calendar-table";
import { ContextBar } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import { IconLaunch } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { fmtDate, fmtLaunchWindow, fmtNumber } from "@/lib/format";
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
    isEvergreen: launch.is_evergreen,
  });

  return (
    <div className="flex flex-col gap-5">
      <ContextBar
        icon={<IconLaunch size={16} />}
        title="Calendario"
        stats={[
          {
            l: "Clase 1",
            v: fmtDate(launch.launch_date),
            // Sin fecha ancla no hay calendario posible — es el gate de la tab.
            c: launch.launch_date ? undefined : "#FFB800",
          },
          {
            l: "Ventana total",
            v: calendar
              ? fmtLaunchWindow(calendar.windowStart, calendar.windowEnd)
              : "—",
          },
          {
            // Un evergreen tiene una sola clase de consumo; el resto, tres.
            l: "Clases de consumo",
            v: calendar ? fmtNumber(calendar.consumo.clase3 ? 3 : 1) : "—",
          },
          { l: "Captación", v: `${fmtNumber(launch.dur_captacion)} días` },
        ]}
      />

      {/*
        El <header> con h2 + <p> (tokens viejos `text-fg` / `text-fg-subtle`)
        se reduce a un lead-in en tipografía KG: el título ya lo pone el
        ContextBar y `LaunchCalendarTable` trae su propio Panel, así que
        envolverla en otro sería anidar dos cajas iguales.
      */}
      <p
        className="kg-t6"
        style={{ margin: 0, color: "var(--kg-text-3)", maxWidth: 720 }}
      >
        Etapas derivadas de la fecha de lanzamiento + las 4 duraciones
        configurables en el form. La ventana total (date_start → date_end) es
        la que usa el sync engine.
      </p>

      {calendar ? (
        <LaunchCalendarTable calendar={calendar} />
      ) : (
        <Panel title="Calendario" pad={false}>
          <EmptyState
            icon={<IconLaunch size={18} />}
            title="Sin fecha de lanzamiento"
            hint="Editá el lanzamiento para definir la fecha de clase 1 y ver las etapas derivadas."
          />
        </Panel>
      )}
    </div>
  );
}
