import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { KgFilterSelect } from "@/components/kg/filter-select";
import { IconMkt } from "@/components/kg/icons";
import { KgPageFilters } from "@/components/kg/page-menu";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";
import { getOrgPeople } from "@/lib/finance/reference";
import { createClient } from "@/lib/supabase/server";

import { EdicionView, type EditRowData } from "./edicion-view";
import { NewEditButton } from "./new-edit-button";

export const metadata: Metadata = { title: "Marketing · Edición" };

// ═══════════════════════════════════════════════════════════════════════════
// Bloque 3 · Edición — reescrito sobre content_edits (0180).
//
// Fetch:
//   - content_edits (con editor + owner + crudo resueltos por nombre)
//   - content_owners + organization_people (pickers del drawer)
//   - content_raws (picker "crudo a editar")
//   - content_pieces (picker opcional del drawer de cierre)
//   - editor_availability (planning semanal — sólo el rango visible)
//
// Filtros vía searchParams:
//   ?editor=<uuid>|all        — default 'all'
//   ?owner=<uuid>|all         — default 'all'
//   ?status=queued|done|all   — default 'all' (queued = completed_at IS NULL)
//
// Planning window: por defecto 4 semanas empezando el lunes de esta semana.
// ═══════════════════════════════════════════════════════════════════════════

interface OwnerLite {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
}

interface PersonLite {
  readonly id: string;
  readonly full_name: string;
  readonly active: boolean;
}

interface RawLite {
  readonly id: string;
  readonly content_owner_id: string;
  readonly name: string;
  readonly drive_url: string;
}

interface PieceLite {
  readonly id: string;
  readonly content_owner_id: string;
  readonly title: string;
}

interface EditDbRow {
  readonly id: string;
  readonly content_owner_id: string;
  readonly source_content_raw_id: string | null;
  readonly title: string;
  readonly editor_person_id: string | null;
  readonly due_date: string | null;
  readonly completed_at: string | null;
  readonly notes: string | null;
  readonly created_at: string;
}

interface AvailabilityDbRow {
  readonly person_id: string;
  readonly date_from: string;
  readonly date_to: string;
  readonly available: boolean;
}

type StatusFilter = "queued" | "done" | "all";

export default async function EdicionPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const editorFilter = parseSingle(sp.editor);
  const ownerFilter = parseSingle(sp.owner);
  const statusFilter = parseStatusFilter(sp.status);

  const supabase = await createClient();

  const [ownersRes, personsRef, rawsRes, piecesRes, editsRes, availRes] =
    await Promise.all([
      supabase
        .from("content_owners")
        .select("id, name, active")
        .order("name", { ascending: true }),
      getOrgPeople(),
      supabase
        .from("content_raws")
        .select("id, content_owner_id, name, drive_url")
        .order("created_at", { ascending: false }),
      supabase
        .from("content_pieces")
        .select("id, content_owner_id, title")
        .neq("stage", "descartado"),
      supabase
        .from("content_edits")
        .select(
          "id, content_owner_id, source_content_raw_id, title, editor_person_id, due_date, completed_at, notes, created_at",
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("editor_availability")
        .select("person_id, date_from, date_to, available"),
    ]);

  const owners = (ownersRes.data ?? []) as unknown as OwnerLite[];
  const persons = personsRef as unknown as PersonLite[];
  const raws = (rawsRes.data ?? []) as unknown as RawLite[];
  const pieces = (piecesRes.data ?? []) as unknown as PieceLite[];
  const edits = (editsRes.data ?? []) as unknown as EditDbRow[];
  const availability = (availRes.data ?? []) as unknown as AvailabilityDbRow[];

  const ownersById = new Map<string, OwnerLite>();
  for (const o of owners) ownersById.set(o.id, o);
  const personsById = new Map<string, PersonLite>();
  for (const p of persons) personsById.set(p.id, p);
  const rawsById = new Map<string, RawLite>();
  for (const r of raws) rawsById.set(r.id, r);

  const ownerOptions = owners
    .filter((o) => o.active)
    .map((o) => ({ id: o.id, name: o.name }));
  const personOptions = persons
    .filter((p) => p.active)
    .map((p) => ({ id: p.id, fullName: p.full_name }));
  const rawOptions = raws.map((r) => ({
    id: r.id,
    contentOwnerId: r.content_owner_id,
    label: r.name,
  }));
  const pieceOptionsForComplete = pieces.map((p) => ({
    id: p.id,
    contentOwnerId: p.content_owner_id,
    title: p.title,
  }));

  const normalized: EditRowData[] = edits.map((e) => {
    const raw = e.source_content_raw_id
      ? rawsById.get(e.source_content_raw_id) ?? null
      : null;
    const editor = e.editor_person_id
      ? personsById.get(e.editor_person_id) ?? null
      : null;
    return {
      id: e.id,
      contentOwnerId: e.content_owner_id,
      ownerName: ownersById.get(e.content_owner_id)?.name ?? "(dueño desconocido)",
      sourceContentRawId: e.source_content_raw_id,
      rawLabel: raw?.name ?? null,
      rawDriveUrl: raw?.drive_url ?? null,
      title: e.title,
      editorPersonId: e.editor_person_id,
      editorName: editor?.full_name ?? null,
      dueDate: e.due_date,
      completedAt: e.completed_at,
      notes: e.notes,
      createdAt: e.created_at,
    };
  });

  const editorIdsWithEdits = new Set(
    edits.map((e) => e.editor_person_id).filter((x): x is string => x != null),
  );
  const editorFilterOptions = persons.filter(
    (p) => p.active || editorIdsWithEdits.has(p.id),
  );

  const ownerIdsWithEdits = new Set(edits.map((e) => e.content_owner_id));
  const ownerFilterOptions = owners.filter(
    (o) => o.active || ownerIdsWithEdits.has(o.id),
  );

  const filtered = normalized.filter((r) => {
    if (editorFilter && r.editorPersonId !== editorFilter) return false;
    if (ownerFilter && r.contentOwnerId !== ownerFilter) return false;
    if (statusFilter === "queued" && r.completedAt != null) return false;
    if (statusFilter === "done" && r.completedAt == null) return false;
    return true;
  });

  const totalCount = normalized.length;
  const doneCount = normalized.filter((r) => r.completedAt != null).length;
  const queuedCount = totalCount - doneCount;
  const unassignedCount = normalized.filter((r) => r.editorPersonId == null).length;

  // Planning window: lunes de esta semana + 4 semanas hacia adelante.
  const today = new Date();
  const dowMon = (today.getDay() + 6) % 7;
  const monday = new Date(today);
  monday.setDate(today.getDate() - dowMon);
  const monday4w = new Date(monday);
  monday4w.setDate(monday.getDate() + 27);
  const planningWindow = { since: toYmd(monday), until: toYmd(monday4w) };

  const availabilityInput = availability.map((a) => ({
    personId: a.person_id,
    dateFrom: a.date_from,
    dateTo: a.date_to,
    available: a.available,
  }));

  function buildHref(overrides: Partial<{
    editor: string | null;
    owner: string | null;
    status: StatusFilter;
  }>): string {
    const params = new URLSearchParams();
    const nextEditor = "editor" in overrides ? overrides.editor : editorFilter;
    const nextOwner = "owner" in overrides ? overrides.owner : ownerFilter;
    const nextStatus = overrides.status ?? statusFilter;
    if (nextEditor) params.set("editor", nextEditor);
    if (nextOwner) params.set("owner", nextOwner);
    if (nextStatus !== "all") params.set("status", nextStatus);
    const qs = params.toString();
    return qs ? `/marketing/edicion?${qs}` : "/marketing/edicion";
  }

  const activeFilters =
    (statusFilter !== "all" ? 1 : 0) +
    (editorFilter != null ? 1 : 0) +
    (ownerFilter != null ? 1 : 0);

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <ContextBar
        icon={<IconMkt size={16} />}
        title="Edición de contenido"
        stats={[
          { l: "Total", v: fCount(totalCount) },
          { l: "En cola", v: fCount(queuedCount) },
          { l: "Realizadas", v: fCount(doneCount) },
          { l: "Sin editor", v: fCount(unassignedCount) },
        ]}
      />

      <KgPageFilters activeCount={activeFilters}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <KgFilterSelect
            label="Estado"
            active={statusFilter}
            options={[
              { label: "Todos", value: "all", href: buildHref({ status: "all" }) },
              { label: "En cola", value: "queued", href: buildHref({ status: "queued" }) },
              { label: "Realizadas", value: "done", href: buildHref({ status: "done" }) },
            ]}
          />

          {editorFilterOptions.length > 0 && (
            <KgFilterSelect
              label="Editor"
              active={editorFilter ?? "__all__"}
              options={[
                {
                  label: "Todos los editores",
                  value: "__all__",
                  href: buildHref({ editor: null }),
                },
                ...editorFilterOptions.map((p) => ({
                  label: p.full_name,
                  value: p.id,
                  href: buildHref({ editor: p.id }),
                })),
              ]}
            />
          )}

          {ownerFilterOptions.length > 0 && (
            <KgFilterSelect
              label="Dueño"
              active={ownerFilter ?? "__all__"}
              options={[
                {
                  label: "Todos los dueños",
                  value: "__all__",
                  href: buildHref({ owner: null }),
                },
                ...ownerFilterOptions.map((o) => ({
                  label: o.name,
                  value: o.id,
                  href: buildHref({ owner: o.id }),
                })),
              ]}
            />
          )}
        </div>
      </KgPageFilters>

      <Panel
        title="Ediciones"
        pad={false}
        fillHeight
        actions={
          <NewEditButton
            ownerOptions={ownerOptions}
            personOptions={personOptions}
            rawOptions={rawOptions}
          />
        }
      >
        <EdicionView
          rows={filtered}
          ownerOptions={ownerOptions}
          personOptions={personOptions}
          rawOptions={rawOptions}
          pieceOptions={pieceOptionsForComplete}
          availability={availabilityInput}
          planningWindow={planningWindow}
        />
      </Panel>
    </div>
  );
}

function parseSingle(v: string | string[] | undefined): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function parseStatusFilter(v: string | string[] | undefined): StatusFilter {
  if (typeof v !== "string") return "all";
  if (v === "queued" || v === "done") return v;
  return "all";
}

function toYmd(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
