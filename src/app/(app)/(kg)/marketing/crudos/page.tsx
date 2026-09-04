import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { KgFilterSelect } from "@/components/kg/filter-select";
import { IconMkt } from "@/components/kg/icons";
import { KgPageFilters } from "@/components/kg/page-menu";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";
import { createClient } from "@/lib/supabase/server";

import { CrudosView, type RawRowData } from "./crudos-view";
import { NewRawButton } from "./new-raw-button";

export const metadata: Metadata = { title: "Marketing · Crudos" };

// ═══════════════════════════════════════════════════════════════════════════
// Crudos (0179) — material sin editar. Entre Grabación y Edición: una
// grabación realizada carga acá sus archivos crudos (o se cargan sueltos),
// y desde acá se abre un evento de edición en /marketing/edicion.
//
// Filtros vía searchParams: ?owner=<uuid>|all, ?session=with|without|all
// ═══════════════════════════════════════════════════════════════════════════

interface OwnerLite {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
}

interface SessionLite {
  readonly id: string;
  readonly content_owner_id: string;
  readonly name: string | null;
  readonly scheduled_at: string;
}

interface RawDbRow {
  readonly id: string;
  readonly content_owner_id: string;
  readonly source_recording_session_id: string | null;
  readonly name: string;
  readonly drive_url: string;
  readonly notes: string | null;
}

interface EditLite {
  readonly source_content_raw_id: string | null;
}

type SessionFilter = "with" | "without" | "all";

export default async function CrudosPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const ownerFilter = parseSingle(sp.owner);
  const sessionFilter = parseSessionFilter(sp.session);

  const supabase = await createClient();

  const [ownersRes, sessionsRes, rawsRes, editsRes] = await Promise.all([
    supabase.from("content_owners").select("id, name, active").order("name"),
    supabase
      .from("recording_sessions")
      .select("id, content_owner_id, name, scheduled_at")
      .order("scheduled_at", { ascending: false }),
    supabase
      .from("content_raws")
      .select(
        "id, content_owner_id, source_recording_session_id, name, drive_url, notes",
      )
      .order("created_at", { ascending: false }),
    supabase.from("content_edits").select("source_content_raw_id"),
  ]);

  const owners = (ownersRes.data ?? []) as unknown as OwnerLite[];
  const sessions = (sessionsRes.data ?? []) as unknown as SessionLite[];
  const raws = (rawsRes.data ?? []) as unknown as RawDbRow[];
  const edits = (editsRes.data ?? []) as unknown as EditLite[];

  const ownersById = new Map<string, OwnerLite>();
  for (const o of owners) ownersById.set(o.id, o);
  const sessionsById = new Map<string, SessionLite>();
  for (const s of sessions) sessionsById.set(s.id, s);

  const editsCountByRaw = new Map<string, number>();
  for (const e of edits) {
    if (!e.source_content_raw_id) continue;
    editsCountByRaw.set(
      e.source_content_raw_id,
      (editsCountByRaw.get(e.source_content_raw_id) ?? 0) + 1,
    );
  }

  const ownerOptions = owners
    .filter((o) => o.active)
    .map((o) => ({ id: o.id, name: o.name }));
  const sessionOptions = sessions.map((s) => ({
    id: s.id,
    contentOwnerId: s.content_owner_id,
    label:
      s.name ??
      `${formatDay(s.scheduled_at)} · ${
        ownersById.get(s.content_owner_id)?.name ?? "(dueño)"
      }`,
  }));

  const normalized: RawRowData[] = raws.map((r) => {
    const session = r.source_recording_session_id
      ? sessionsById.get(r.source_recording_session_id) ?? null
      : null;
    return {
      id: r.id,
      contentOwnerId: r.content_owner_id,
      ownerName: ownersById.get(r.content_owner_id)?.name ?? "(dueño desconocido)",
      sourceRecordingSessionId: r.source_recording_session_id,
      sessionLabel: session
        ? (session.name ?? formatDay(session.scheduled_at))
        : null,
      name: r.name,
      driveUrl: r.drive_url,
      notes: r.notes,
      editsCount: editsCountByRaw.get(r.id) ?? 0,
    };
  });

  const ownerIdsWithRows = new Set(raws.map((r) => r.content_owner_id));
  const ownerFilterOptions = owners.filter(
    (o) => o.active || ownerIdsWithRows.has(o.id),
  );

  const filtered = normalized.filter((r) => {
    if (ownerFilter && r.contentOwnerId !== ownerFilter) return false;
    if (sessionFilter === "with" && r.sourceRecordingSessionId == null) return false;
    if (sessionFilter === "without" && r.sourceRecordingSessionId != null) return false;
    return true;
  });

  const withoutEditCount = normalized.filter((r) => r.editsCount === 0).length;

  function buildHref(
    overrides: Partial<{ owner: string | null; session: SessionFilter }>,
  ): string {
    const params = new URLSearchParams();
    const nextOwner = "owner" in overrides ? overrides.owner : ownerFilter;
    const nextSession = overrides.session ?? sessionFilter;
    if (nextOwner) params.set("owner", nextOwner);
    if (nextSession !== "all") params.set("session", nextSession);
    const qs = params.toString();
    return qs ? `/marketing/crudos?${qs}` : "/marketing/crudos";
  }

  const activeFilters =
    (ownerFilter != null ? 1 : 0) + (sessionFilter !== "all" ? 1 : 0);

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <ContextBar
        icon={<IconMkt size={16} />}
        title="Crudos"
        stats={[
          { l: "Total", v: fCount(normalized.length) },
          { l: "Sin editar", v: fCount(withoutEditCount) },
        ]}
      />

      <KgPageFilters activeCount={activeFilters}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
            label="Origen"
            active={sessionFilter}
            options={[
              { label: "Todos", value: "all", href: buildHref({ session: "all" }) },
              {
                label: "Con sesión",
                value: "with",
                href: buildHref({ session: "with" }),
              },
              {
                label: "Sin sesión",
                value: "without",
                href: buildHref({ session: "without" }),
              },
            ]}
          />
        </div>
      </KgPageFilters>

      <Panel
        title="Material crudo"
        pad={false}
        fillHeight
        actions={
          <NewRawButton ownerOptions={ownerOptions} sessionOptions={sessionOptions} />
        }
      >
        <CrudosView
          rows={filtered}
          ownerOptions={ownerOptions}
          sessionOptions={sessionOptions}
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

function parseSessionFilter(v: string | string[] | undefined): SessionFilter {
  if (typeof v !== "string") return "all";
  if (v === "with" || v === "without") return v;
  return "all";
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}
