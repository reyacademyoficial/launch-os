import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { KgFilterSelect } from "@/components/kg/filter-select";
import { IconMkt } from "@/components/kg/icons";
import { KgPageFilters } from "@/components/kg/page-menu";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";
import {
  FORMAT_LABEL,
  isMarketingFormat,
  MARKETING_FORMATS,
  type MarketingFormat,
} from "@/lib/marketing/types";
import { getOrgPeople } from "@/lib/finance/reference";
import { createClient } from "@/lib/supabase/server";

import {
  EdicionView,
  type AssetRowData,
} from "./edicion-view";
import { NewAssetButton } from "./new-asset-button";

export const metadata: Metadata = { title: "Marketing · Edición" };

// ═══════════════════════════════════════════════════════════════════════════
// Bloque 3 · Edición.
//
// Fetch:
//   - content_assets (con editor + owner + sesión + piece resueltos por nombre)
//   - content_owners + organization_people (pickers del drawer)
//   - recording_sessions (para picker "sesión origen")
//   - content_pieces (para picker "piece origen")
//   - editor_availability (para el planning semanal — solo el rango visible)
//
// Filtros vía searchParams:
//   ?editor=<uuid>|all       — default 'all'
//   ?owner=<uuid>|all        — default 'all'
//   ?format=<format>|all     — default 'all'
//   ?status=queued|edited|all — default 'all' (queued = edited_at IS NULL)
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

interface SessionLite {
  readonly id: string;
  readonly content_owner_id: string;
  readonly scheduled_at: string;
  readonly status: string;
}

interface PieceLite {
  readonly id: string;
  readonly content_owner_id: string;
  readonly title: string;
  readonly recording_session_id: string | null;
}

interface AssetDbRow {
  readonly id: string;
  readonly content_owner_id: string;
  readonly source_recording_session_id: string | null;
  readonly source_content_piece_id: string | null;
  readonly name: string;
  readonly format: string;
  readonly drive_folder_url: string | null;
  readonly drive_asset_url: string | null;
  readonly duration_seconds: number | null;
  readonly editor_person_id: string | null;
  readonly edited_at: string | null;
  readonly notes: string | null;
  readonly created_at: string;
}

interface AvailabilityDbRow {
  readonly person_id: string;
  readonly date_from: string;
  readonly date_to: string;
  readonly available: boolean;
}

type StatusFilter = "queued" | "edited" | "all";

export default async function EdicionPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const editorFilter = parseSingle(sp.editor);
  const ownerFilter = parseSingle(sp.owner);
  const formatFilter = parseFormatFilter(sp.format);
  const statusFilter = parseStatusFilter(sp.status);

  const supabase = await createClient();

  const [ownersRes, personsRef, sessionsRes, piecesRes, assetsRes, availRes] =
    await Promise.all([
      supabase
        .from("content_owners")
        .select("id, name, active")
        .order("name", { ascending: true }),
      getOrgPeople(),
      supabase
        .from("recording_sessions")
        .select("id, content_owner_id, scheduled_at, status")
        .order("scheduled_at", { ascending: false }),
      supabase
        .from("content_pieces")
        .select("id, content_owner_id, title, recording_session_id")
        .neq("stage", "descartado"),
      supabase
        .from("content_assets")
        .select(
          "id, content_owner_id, source_recording_session_id, source_content_piece_id, name, format, drive_folder_url, drive_asset_url, duration_seconds, editor_person_id, edited_at, notes, created_at",
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("editor_availability")
        .select("person_id, date_from, date_to, available"),
    ]);

  const owners = (ownersRes.data ?? []) as unknown as OwnerLite[];
  const persons = personsRef as unknown as PersonLite[];
  const sessions = (sessionsRes.data ?? []) as unknown as SessionLite[];
  const pieces = (piecesRes.data ?? []) as unknown as PieceLite[];
  const assets = (assetsRes.data ?? []) as unknown as AssetDbRow[];
  const availability = (availRes.data ?? []) as unknown as AvailabilityDbRow[];

  const ownersById = new Map<string, OwnerLite>();
  for (const o of owners) ownersById.set(o.id, o);
  const personsById = new Map<string, PersonLite>();
  for (const p of persons) personsById.set(p.id, p);
  const sessionsById = new Map<string, SessionLite>();
  for (const s of sessions) sessionsById.set(s.id, s);
  const piecesById = new Map<string, PieceLite>();
  for (const p of pieces) piecesById.set(p.id, p);

  const ownerOptions = owners
    .filter((o) => o.active)
    .map((o) => ({ id: o.id, name: o.name }));
  const personOptions = persons
    .filter((p) => p.active)
    .map((p) => ({ id: p.id, fullName: p.full_name }));
  const sessionOptions = sessions.map((s) => ({
    id: s.id,
    contentOwnerId: s.content_owner_id,
    label: `${formatDay(s.scheduled_at)} · ${
      ownersById.get(s.content_owner_id)?.name ?? "(dueño)"
    }`,
  }));
  // Sesiones elegibles para el batch drawer del "+ Registrar producción".
  // Sólo las 'realizada' — no tiene sentido cargar producción de una sesión
  // que todavía no se grabó.
  const batchSessionOptions = sessions
    .filter((s) => s.status === "realizada")
    .map((s) => ({
      id: s.id,
      contentOwnerId: s.content_owner_id,
      ownerName:
        ownersById.get(s.content_owner_id)?.name ?? "(dueño desconocido)",
      scheduledAt: s.scheduled_at,
      status: s.status,
    }));
  const pieceOptions = pieces.map((p) => ({
    id: p.id,
    contentOwnerId: p.content_owner_id,
    title: p.title,
    recordingSessionId: p.recording_session_id,
  }));

  const normalized: AssetRowData[] = assets
    .filter((a): a is AssetDbRow & { readonly format: MarketingFormat } =>
      isMarketingFormat(a.format),
    )
    .map((a) => {
      const session = a.source_recording_session_id
        ? sessionsById.get(a.source_recording_session_id) ?? null
        : null;
      const piece = a.source_content_piece_id
        ? piecesById.get(a.source_content_piece_id) ?? null
        : null;
      const editor = a.editor_person_id
        ? personsById.get(a.editor_person_id) ?? null
        : null;
      return {
        id: a.id,
        contentOwnerId: a.content_owner_id,
        ownerName:
          ownersById.get(a.content_owner_id)?.name ?? "(dueño desconocido)",
        sourceRecordingSessionId: a.source_recording_session_id,
        sessionLabel: session ? formatDay(session.scheduled_at) : null,
        sourceContentPieceId: a.source_content_piece_id,
        pieceTitle: piece?.title ?? null,
        name: a.name,
        format: a.format,
        driveFolderUrl: a.drive_folder_url,
        driveAssetUrl: a.drive_asset_url,
        durationSeconds: a.duration_seconds,
        editorPersonId: a.editor_person_id,
        editorName: editor?.full_name ?? null,
        editedAt: a.edited_at,
        notes: a.notes,
        createdAt: a.created_at,
      };
    });

  // Editor set: incluye TODAS las personas activas + los editores históricos
  // que aparezcan en assets. El filtro por editor las lista.
  const editorIdsWithAssets = new Set(
    assets
      .map((a) => a.editor_person_id)
      .filter((x): x is string => x != null),
  );
  const editorFilterOptions = persons.filter(
    (p) => p.active || editorIdsWithAssets.has(p.id),
  );

  const ownerIdsWithAssets = new Set(assets.map((a) => a.content_owner_id));
  const ownerFilterOptions = owners.filter(
    (o) => o.active || ownerIdsWithAssets.has(o.id),
  );

  const filtered = normalized.filter((r) => {
    if (editorFilter && r.editorPersonId !== editorFilter) return false;
    if (ownerFilter && r.contentOwnerId !== ownerFilter) return false;
    if (formatFilter !== "all" && r.format !== formatFilter) return false;
    if (statusFilter === "queued" && r.editedAt != null) return false;
    if (statusFilter === "edited" && r.editedAt == null) return false;
    return true;
  });

  const totalCount = normalized.length;
  const editedCount = normalized.filter((r) => r.editedAt != null).length;
  const queuedCount = totalCount - editedCount;
  const unassignedCount = normalized.filter(
    (r) => r.editorPersonId == null,
  ).length;

  // Planning window: lunes de esta semana + 4 semanas hacia adelante.
  const today = new Date();
  const dowMon = (today.getDay() + 6) % 7; // 0=lunes
  const monday = new Date(today);
  monday.setDate(today.getDate() - dowMon);
  const monday4w = new Date(monday);
  monday4w.setDate(monday.getDate() + 27); // 4 semanas de 7 días
  const planningWindow = {
    since: toYmd(monday),
    until: toYmd(monday4w),
  };

  const availabilityInput = availability.map((a) => ({
    personId: a.person_id,
    dateFrom: a.date_from,
    dateTo: a.date_to,
    available: a.available,
  }));

  function buildHref(overrides: Partial<{
    editor: string | null;
    owner: string | null;
    format: MarketingFormat | "all";
    status: StatusFilter;
  }>): string {
    const params = new URLSearchParams();
    const nextEditor = "editor" in overrides ? overrides.editor : editorFilter;
    const nextOwner = "owner" in overrides ? overrides.owner : ownerFilter;
    const nextFormat = overrides.format ?? formatFilter;
    const nextStatus = overrides.status ?? statusFilter;
    if (nextEditor) params.set("editor", nextEditor);
    if (nextOwner) params.set("owner", nextOwner);
    if (nextFormat !== "all") params.set("format", nextFormat);
    if (nextStatus !== "all") params.set("status", nextStatus);
    const qs = params.toString();
    return qs ? `/marketing/edicion?${qs}` : "/marketing/edicion";
  }

  const activeFilters =
    (statusFilter !== "all" ? 1 : 0) +
    (editorFilter != null ? 1 : 0) +
    (ownerFilter != null ? 1 : 0) +
    (formatFilter !== "all" ? 1 : 0);

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <ContextBar
        icon={<IconMkt size={16} />}
        title="Edición de contenido"
        stats={[
          { l: "Total", v: fCount(totalCount) },
          { l: "En cola", v: fCount(queuedCount) },
          { l: "Editados", v: fCount(editedCount) },
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
              { label: "Editados", value: "edited", href: buildHref({ status: "edited" }) },
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

          <KgFilterSelect
            label="Formato"
            active={formatFilter}
            options={[
              {
                label: "Todos los formatos",
                value: "all",
                href: buildHref({ format: "all" }),
              },
              ...MARKETING_FORMATS.map((f) => ({
                label: FORMAT_LABEL[f],
                value: f,
                href: buildHref({ format: f }),
              })),
            ]}
          />
        </div>
      </KgPageFilters>

      <Panel
        title="Assets producidos"
        pad={false}
        fillHeight
        actions={
          <NewAssetButton
            sessionOptions={batchSessionOptions}
            personOptions={personOptions}
          />
        }
      >
        <EdicionView
          rows={filtered}
          ownerOptions={ownerOptions}
          personOptions={personOptions}
          sessionOptions={sessionOptions}
          pieceOptions={pieceOptions}
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

function parseFormatFilter(
  v: string | string[] | undefined,
): MarketingFormat | "all" {
  if (typeof v !== "string") return "all";
  if (isMarketingFormat(v)) return v;
  return "all";
}

function parseStatusFilter(
  v: string | string[] | undefined,
): StatusFilter {
  if (typeof v !== "string") return "all";
  if (v === "queued" || v === "edited") return v;
  return "all";
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

function toYmd(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
