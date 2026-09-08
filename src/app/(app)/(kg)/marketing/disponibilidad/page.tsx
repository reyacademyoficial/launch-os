import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { KgFilterSelect } from "@/components/kg/filter-select";
import { IconCamera } from "@/components/kg/icons";
import { KgPageFilters } from "@/components/kg/page-menu";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";
import { getOrgPeople } from "@/lib/finance/reference";
import {
  isMarketingFormat,
  isWeekday,
  type MarketingFormat,
  type Weekday,
} from "@/lib/marketing/types";
import { createClient } from "@/lib/supabase/server";

import {
  DisponibilidadView,
  type AvailabilityRowData,
} from "./disponibilidad-view";
import { FormatCapacityView, type FormatCapacityRowData } from "./format-capacity-view";
import { NewAvailabilityButton } from "./new-availability-button";
import { NewFormatCapacityButton } from "./new-format-capacity-button";
import { NewWeeklyScheduleButton } from "./new-weekly-schedule-button";
import { WeeklyScheduleView, type WeeklyScheduleRowData } from "./weekly-schedule-view";

export const metadata: Metadata = { title: "Producción · Disponibilidad" };

// ═══════════════════════════════════════════════════════════════════════════
// Bloque 3 (config) · editor_availability.
//
// Filtros vía searchParams:
//   ?person=<uuid>|all — default 'all'
//
// Sin filtro por mes por ahora — con volúmenes iniciales, la tabla plana
// alcanza. Si crece, se agrega ?year=&month= igual que la vista calendario
// de grabación.
// ═══════════════════════════════════════════════════════════════════════════

interface PersonLite {
  readonly id: string;
  readonly full_name: string;
  readonly active: boolean;
}

interface AvailabilityDbRow {
  readonly id: string;
  readonly person_id: string;
  readonly date_from: string;
  readonly date_to: string;
  readonly available: boolean;
  readonly notes: string | null;
}

interface WeeklyScheduleDbRow {
  readonly id: string;
  readonly person_id: string;
  readonly day_of_week: number;
  readonly start_time: string;
  readonly end_time: string;
  readonly notes: string | null;
}

interface FormatCapacityDbRow {
  readonly person_id: string;
  readonly format: string;
  readonly max_per_day: number;
}

export default async function DisponibilidadPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const personFilter = parseSingle(sp.person);

  const supabase = await createClient();

  const [personsRef, availRes, scheduleRes, capacityRes] = await Promise.all([
    getOrgPeople(),
    supabase
      .from("editor_availability")
      .select("id, person_id, date_from, date_to, available, notes")
      .order("date_from", { ascending: false }),
    supabase
      .from("editor_weekly_schedule")
      .select("id, person_id, day_of_week, start_time, end_time, notes")
      .order("day_of_week", { ascending: true }),
    supabase
      .from("editor_format_capacity")
      .select("person_id, format, max_per_day"),
  ]);

  const persons = personsRef as unknown as PersonLite[];
  const rowsRaw = (availRes.data ?? []) as unknown as AvailabilityDbRow[];
  const scheduleRaw = (scheduleRes.data ?? []) as unknown as WeeklyScheduleDbRow[];
  const capacityRaw = (capacityRes.data ?? []) as unknown as FormatCapacityDbRow[];

  const personsById = new Map<string, PersonLite>();
  for (const p of persons) personsById.set(p.id, p);

  const personOptions = persons
    .filter((p) => p.active)
    .map((p) => ({ id: p.id, fullName: p.full_name }));

  const personIdsWithRows = new Set(rowsRaw.map((r) => r.person_id));
  const personFilterOptions = persons.filter(
    (p) => p.active || personIdsWithRows.has(p.id),
  );

  const rows: AvailabilityRowData[] = rowsRaw.map((r) => ({
    id: r.id,
    personId: r.person_id,
    personName: personsById.get(r.person_id)?.full_name ?? "(persona desconocida)",
    dateFrom: r.date_from,
    dateTo: r.date_to,
    available: r.available,
    notes: r.notes,
  }));

  const filtered = personFilter
    ? rows.filter((r) => r.personId === personFilter)
    : rows;

  const availableCount = rows.filter((r) => r.available).length;
  const blockedCount = rows.length - availableCount;

  const scheduleRows: WeeklyScheduleRowData[] = scheduleRaw
    .filter(
      (r): r is WeeklyScheduleDbRow & { readonly day_of_week: Weekday } =>
        isWeekday(r.day_of_week),
    )
    .map((r) => ({
      id: r.id,
      personId: r.person_id,
      personName:
        personsById.get(r.person_id)?.full_name ?? "(persona desconocida)",
      dayOfWeek: r.day_of_week,
      startTime: r.start_time,
      endTime: r.end_time,
      notes: r.notes,
    }));
  const filteredSchedule = personFilter
    ? scheduleRows.filter((r) => r.personId === personFilter)
    : scheduleRows;

  const capacityRows: FormatCapacityRowData[] = capacityRaw
    .filter((c): c is FormatCapacityDbRow & { readonly format: MarketingFormat } =>
      isMarketingFormat(c.format),
    )
    .map((c) => ({
      personId: c.person_id,
      personName:
        personsById.get(c.person_id)?.full_name ?? "(persona desconocida)",
      format: c.format,
      maxPerDay: c.max_per_day,
    }));
  const filteredCapacity = personFilter
    ? capacityRows.filter((r) => r.personId === personFilter)
    : capacityRows;

  function buildHref(overrides: Partial<{ person: string | null }>): string {
    const params = new URLSearchParams();
    const nextPerson = "person" in overrides ? overrides.person : personFilter;
    if (nextPerson) params.set("person", nextPerson);
    const qs = params.toString();
    return qs ? `/marketing/disponibilidad?${qs}` : "/marketing/disponibilidad";
  }

  return (
    // Sin h-full/min-h-0: esta página apila 3 tablas (horario, capacidad,
    // excepciones) en vez de una sola fillHeight — el flujo natural + el
    // scroll del <main> del shell (overflow-y-auto) es lo que necesitamos,
    // no el pattern flex-fill de una tabla única.
    <div className="flex flex-col gap-5">
      <ContextBar
        icon={<IconCamera size={16} />}
        title="Disponibilidad de editores"
        stats={[
          { l: "Horarios semanales", v: fCount(scheduleRows.length) },
          { l: "Capacidades configuradas", v: fCount(capacityRows.length) },
          { l: "Excepciones", v: fCount(rows.length) },
          { l: "Ausencias", v: fCount(blockedCount) },
        ]}
      />

      {personFilterOptions.length > 0 && (
        <KgPageFilters activeCount={personFilter != null ? 1 : 0}>
          <KgFilterSelect
            label="Persona"
            active={personFilter ?? "__all__"}
            options={[
              {
                label: "Todas las personas",
                value: "__all__",
                href: buildHref({ person: null }),
              },
              ...personFilterOptions.map((p) => ({
                label: p.full_name,
                value: p.id,
                href: buildHref({ person: p.id }),
              })),
            ]}
          />
        </KgPageFilters>
      )}

      <Panel
        title="Horario semanal"
        pad={false}
        actions={<NewWeeklyScheduleButton personOptions={personOptions} />}
      >
        <WeeklyScheduleView rows={filteredSchedule} personOptions={personOptions} />
      </Panel>

      <Panel
        title="Capacidad máxima por formato"
        pad={false}
        actions={<NewFormatCapacityButton personOptions={personOptions} />}
      >
        <FormatCapacityView rows={filteredCapacity} personOptions={personOptions} />
      </Panel>

      <Panel
        title="Bloques de disponibilidad (excepciones)"
        pad={false}
        actions={<NewAvailabilityButton personOptions={personOptions} />}
      >
        <DisponibilidadView rows={filtered} personOptions={personOptions} />
      </Panel>
    </div>
  );
}

function parseSingle(v: string | string[] | undefined): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}
