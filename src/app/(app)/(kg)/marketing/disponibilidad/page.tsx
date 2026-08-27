import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { KgFilterSelect } from "@/components/kg/filter-select";
import { IconMkt } from "@/components/kg/icons";
import { KgPageFilters } from "@/components/kg/page-menu";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";
import { getOrgPeople } from "@/lib/finance/reference";
import { createClient } from "@/lib/supabase/server";

import {
  DisponibilidadView,
  type AvailabilityRowData,
} from "./disponibilidad-view";
import { NewAvailabilityButton } from "./new-availability-button";

export const metadata: Metadata = { title: "Marketing · Disponibilidad" };

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

export default async function DisponibilidadPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const personFilter = parseSingle(sp.person);

  const supabase = await createClient();

  const [personsRef, availRes] = await Promise.all([
    getOrgPeople(),
    supabase
      .from("editor_availability")
      .select("id, person_id, date_from, date_to, available, notes")
      .order("date_from", { ascending: false }),
  ]);

  const persons = personsRef as unknown as PersonLite[];
  const rowsRaw = (availRes.data ?? []) as unknown as AvailabilityDbRow[];

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

  function buildHref(overrides: Partial<{ person: string | null }>): string {
    const params = new URLSearchParams();
    const nextPerson = "person" in overrides ? overrides.person : personFilter;
    if (nextPerson) params.set("person", nextPerson);
    const qs = params.toString();
    return qs ? `/marketing/disponibilidad?${qs}` : "/marketing/disponibilidad";
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <ContextBar
        icon={<IconMkt size={16} />}
        title="Disponibilidad de editores"
        stats={[
          { l: "Bloques", v: fCount(rows.length) },
          { l: "Disponibles", v: fCount(availableCount) },
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
        title="Bloques de disponibilidad"
        pad={false}
        fillHeight
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
