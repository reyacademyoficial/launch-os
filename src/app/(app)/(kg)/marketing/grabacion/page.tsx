import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconMkt } from "@/components/kg/icons";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";
import {
  isRecordingRole,
  isRecordingSessionStatus,
  type RecordingRole,
  type RecordingSessionStatus,
} from "@/lib/marketing/types";
import { createClient } from "@/lib/supabase/server";

import {
  GrabacionView,
  type SessionRowData,
} from "./grabacion-view";

export const metadata: Metadata = { title: "Marketing · Grabación" };

// ═══════════════════════════════════════════════════════════════════════════
// Listado de recording_sessions con toggle tabla|calendario.
//
//   ?view=tabla|calendario   — default 'tabla'
//   ?year=YYYY&month=MM      — solo tiene efecto en calendario, default hoy
//
// Fetch: sessions + assignees (con person.full_name) + pieces (con
// content_owner_id para el picker del drawer y titles para la vista).
// Con volúmenes iniciales alcanza. Cuando crezca, agregamos filtro por
// rango de fechas server-side.
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

interface SessionDbRow {
  readonly id: string;
  readonly content_owner_id: string;
  readonly scheduled_at: string;
  readonly duration_minutes: number | null;
  readonly location: string | null;
  readonly materials: string | null;
  readonly notes: string | null;
  readonly status: string;
}

interface AssigneeDbRow {
  readonly recording_session_id: string;
  readonly person_id: string;
  readonly role: string;
}

interface PieceDbRow {
  readonly id: string;
  readonly title: string;
  readonly content_owner_id: string;
  readonly stage: string;
  readonly recording_session_id: string | null;
}

export default async function GrabacionPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const view = parseView(sp.view);
  const { year, month } = parseMonth(sp.year, sp.month);

  const supabase = await createClient();

  const [ownersRes, personsRes, sessionsRes, assigneesRes, piecesRes] =
    await Promise.all([
      supabase
        .from("content_owners")
        .select("id, name, active")
        .order("name", { ascending: true }),
      supabase
        .from("organization_people")
        .select("id, full_name, active")
        .order("full_name", { ascending: true }),
      supabase
        .from("recording_sessions")
        .select(
          "id, content_owner_id, scheduled_at, duration_minutes, location, materials, notes, status",
        )
        .order("scheduled_at", { ascending: false }),
      supabase
        .from("recording_assignees")
        .select("recording_session_id, person_id, role"),
      supabase
        .from("content_pieces")
        .select(
          "id, title, content_owner_id, stage, recording_session_id",
        )
        .neq("stage", "descartado"),
    ]);

  const owners = (ownersRes.data ?? []) as unknown as OwnerLite[];
  const persons = (personsRes.data ?? []) as unknown as PersonLite[];
  const sessions = (sessionsRes.data ?? []) as unknown as SessionDbRow[];
  const assignees = (assigneesRes.data ?? []) as unknown as AssigneeDbRow[];
  const pieces = (piecesRes.data ?? []) as unknown as PieceDbRow[];

  const ownersById = new Map<string, OwnerLite>();
  for (const o of owners) ownersById.set(o.id, o);
  const personsById = new Map<string, PersonLite>();
  for (const p of persons) personsById.set(p.id, p);

  // Owners activos para el picker; personas activas para el picker de assignees.
  const ownerOptions = owners
    .filter((o) => o.active)
    .map((o) => ({ id: o.id, name: o.name }));
  const personOptions = persons
    .filter((p) => p.active)
    .map((p) => ({ id: p.id, fullName: p.full_name }));
  const pieceOptions = pieces.map((p) => ({
    id: p.id,
    title: p.title,
    contentOwnerId: p.content_owner_id,
    stage: p.stage,
    recordingSessionId: p.recording_session_id,
  }));

  // Agrupar assignees por session (resolvidos a full_name).
  const assigneesBySession = new Map<
    string,
    Array<{ personId: string; personName: string; role: RecordingRole }>
  >();
  for (const a of assignees) {
    if (!isRecordingRole(a.role)) continue;
    const person = personsById.get(a.person_id);
    const arr = assigneesBySession.get(a.recording_session_id) ?? [];
    arr.push({
      personId: a.person_id,
      personName: person?.full_name ?? "(persona desconocida)",
      role: a.role,
    });
    assigneesBySession.set(a.recording_session_id, arr);
  }

  // Agrupar pieces por session (para count + para pasar los ids al drawer).
  const piecesBySession = new Map<string, string[]>();
  for (const p of pieces) {
    if (p.recording_session_id == null) continue;
    const arr = piecesBySession.get(p.recording_session_id) ?? [];
    arr.push(p.id);
    piecesBySession.set(p.recording_session_id, arr);
  }

  const rows: SessionRowData[] = sessions
    .filter((s): s is SessionDbRow & { readonly status: RecordingSessionStatus } =>
      isRecordingSessionStatus(s.status),
    )
    .map((s) => {
      const pieceIds = piecesBySession.get(s.id) ?? [];
      return {
        id: s.id,
        contentOwnerId: s.content_owner_id,
        ownerName:
          ownersById.get(s.content_owner_id)?.name ?? "(dueño desconocido)",
        scheduledAt: s.scheduled_at,
        durationMinutes: s.duration_minutes,
        location: s.location,
        materials: s.materials,
        notes: s.notes,
        status: s.status,
        assignees: assigneesBySession.get(s.id) ?? [],
        pieceIds,
        piecesCount: pieceIds.length,
      };
    });

  const openCount = rows.filter(
    (r) => r.status !== "realizada" && r.status !== "cancelada",
  ).length;
  const doneCount = rows.filter((r) => r.status === "realizada").length;
  const upcoming7d = rows.filter((r) => isWithinNextDays(r.scheduledAt, 7)).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconMkt size={16} />}
        title="Grabaciones"
        stats={[
          { l: "Total", v: fCount(rows.length) },
          { l: "Abiertas", v: fCount(openCount) },
          { l: "Realizadas", v: fCount(doneCount) },
          { l: "Próximos 7 días", v: fCount(upcoming7d) },
        ]}
      />

      <KgParamPills
        ariaLabel="Cambiar vista"
        options={[
          {
            label: "Tabla",
            href: buildViewHref("tabla", year, month),
            active: view === "tabla",
          },
          {
            label: "Calendario",
            href: buildViewHref("calendario", year, month),
            active: view === "calendario",
          },
        ]}
      />

      <Panel title={view === "tabla" ? "Sesiones planificadas" : "Calendario mensual"}>
        <GrabacionView
          view={view}
          rows={rows}
          year={year}
          month={month}
          baseHref="/marketing/grabacion"
          preserveParams={{ view: "calendario" }}
          ownerOptions={ownerOptions}
          personOptions={personOptions}
          pieceOptions={pieceOptions}
        />
      </Panel>
    </div>
  );
}

function parseView(v: string | string[] | undefined): "tabla" | "calendario" {
  if (typeof v !== "string") return "tabla";
  return v === "calendario" ? "calendario" : "tabla";
}

function parseMonth(
  yearRaw: string | string[] | undefined,
  monthRaw: string | string[] | undefined,
): { year: number; month: number } {
  const now = new Date();
  const year =
    typeof yearRaw === "string" ? Number.parseInt(yearRaw, 10) : NaN;
  const month =
    typeof monthRaw === "string" ? Number.parseInt(monthRaw, 10) : NaN;
  const safeYear =
    Number.isFinite(year) && year >= 1970 && year <= 3000 ? year : now.getFullYear();
  const safeMonth =
    Number.isFinite(month) && month >= 1 && month <= 12 ? month : now.getMonth() + 1;
  return { year: safeYear, month: safeMonth };
}

function buildViewHref(
  next: "tabla" | "calendario",
  year: number,
  month: number,
): string {
  const params = new URLSearchParams();
  if (next !== "tabla") params.set("view", next);
  if (next === "calendario") {
    params.set("year", String(year));
    params.set("month", String(month).padStart(2, "0"));
  }
  const qs = params.toString();
  return qs ? `/marketing/grabacion?${qs}` : "/marketing/grabacion";
}

function isWithinNextDays(iso: string, days: number): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  const diff = d.getTime() - now.getTime();
  return diff >= 0 && diff <= days * 24 * 60 * 60 * 1000;
}
