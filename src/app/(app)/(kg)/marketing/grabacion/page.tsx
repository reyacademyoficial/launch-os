import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconCalendar, IconMkt, IconTable } from "@/components/kg/icons";
import { KgPageFilters } from "@/components/kg/page-menu";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { KgViewToggle } from "@/components/kg/view-toggle";
import { fCount } from "@/lib/finance/format";
import { resolvePeriod, type Period } from "@/lib/finance/period";
import {
  isRecordingRole,
  isRecordingSessionStatus,
  type RecordingRole,
  type RecordingSessionStatus,
} from "@/lib/marketing/types";
import { createClient } from "@/lib/supabase/server";

import { RangePills, type PresetOption } from "../../financiero/range-pills";

import {
  GrabacionView,
  type SessionRowData,
} from "./grabacion-view";
import { NewSessionButton } from "./new-session-button";
import {
  PendingPiecesPanel,
  type PendingGroup,
  type PendingPiece,
} from "./pending-pieces-panel";

export const metadata: Metadata = { title: "Marketing · Grabación" };

// ═══════════════════════════════════════════════════════════════════════════
// Listado de recording_sessions con toggle tabla|calendario.
//
//   ?view=tabla|calendario   — default 'tabla'
//   ?year=YYYY&month=MM      — solo tiene efecto en calendario, default hoy
//   ?range=todo|mes-actual|mes-anterior|90d — solo en vista tabla
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD — rango custom, solo en vista tabla
//
// Fetch: sessions + assignees (con person.full_name) + pieces (con
// content_owner_id para el picker del drawer y titles para la vista).
// En vista tabla el rango filtra `scheduled_at` server-side. En calendario
// no aplica — el usuario navega con las flechas del mes.
//
// Los "pending" (pieces con fecha sin sesión) NO se filtran por rango — son
// backlog operativo y el usuario los tiene que ver siempre, esté mirando el
// rango que sea.
// ═══════════════════════════════════════════════════════════════════════════

type RangeParam = "todo" | "mes-actual" | "mes-anterior" | "90d" | "custom";

const RANGE_PRESETS: readonly PresetOption[] = [
  { value: "todo", label: "Todo" },
  { value: "mes-actual", label: "Mes actual" },
  { value: "mes-anterior", label: "Mes anterior" },
  { value: "90d", label: "90 días" },
];

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
  readonly scheduled_recording_at: string | null;
}

export default async function GrabacionPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const view = parseView(sp.view);
  const { year, month } = parseMonth(sp.year, sp.month);
  const rangeParam = parseRange(sp.range);
  const fromParam = parseYmd(sp.from);
  const toParam = parseYmd(sp.to);

  // El rango temporal SOLO se aplica en vista tabla. En calendario navegás
  // por mes con las flechas — el filtro no aplica.
  const isCustom = fromParam != null && toParam != null;
  const effectiveRange: RangeParam = isCustom ? "custom" : rangeParam;
  const period: Period | null =
    view !== "tabla" || effectiveRange === "todo"
      ? null
      : isCustom
        ? resolvePeriod({ from: fromParam, to: toParam })
        : resolvePeriod({ range: effectiveRange });

  const supabase = await createClient();

  let sessionsQuery = supabase
    .from("recording_sessions")
    .select(
      "id, content_owner_id, scheduled_at, duration_minutes, location, materials, notes, status",
    )
    .order("scheduled_at", { ascending: false });
  if (period) {
    // scheduled_at es timestamptz; comparamos contra rangos de día inclusivos.
    // fromYmd → 00:00 (implícito al comparar >= 'YYYY-MM-DD'); para toYmd
    // usamos < día siguiente para incluir todo el día completo.
    const toNextDay = addDaysYmd(period.toYmd, 1);
    sessionsQuery = sessionsQuery
      .gte("scheduled_at", period.fromYmd)
      .lt("scheduled_at", toNextDay);
  }

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
      sessionsQuery,
      supabase
        .from("recording_assignees")
        .select("recording_session_id, person_id, role"),
      supabase
        .from("content_pieces")
        .select(
          "id, title, content_owner_id, stage, recording_session_id, scheduled_recording_at",
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

  // ─── Pendientes: pieces con fecha planificada pero sin sesión asignada.
  // Agrupamos por (owner, día calendario local) — pieces del mismo dueño el
  // mismo día se ofrecen como una única sesión (el usuario ajusta hora exacta
  // en el drawer). Sólo se calcula acá; el panel decide si mostrarse.
  const pendingPieces: PendingPiece[] = pieces
    .filter(
      (p): p is PieceDbRow & { readonly scheduled_recording_at: string } =>
        p.scheduled_recording_at != null &&
        p.recording_session_id == null &&
        p.stage === "planificado",
    )
    .map((p) => ({
      id: p.id,
      title: p.title,
      contentOwnerId: p.content_owner_id,
      ownerName:
        ownersById.get(p.content_owner_id)?.name ?? "(dueño desconocido)",
      scheduledRecordingAt: p.scheduled_recording_at,
    }));

  const pendingGroupsMap = new Map<string, PendingGroup & { pieces: PendingPiece[] }>();
  for (const p of pendingPieces) {
    const dateKey = toLocalYmd(p.scheduledRecordingAt);
    const key = `${p.contentOwnerId}::${dateKey}`;
    const existing = pendingGroupsMap.get(key);
    if (existing) {
      existing.pieces.push(p);
      // Mantener firstIsoAt como el más temprano del día.
      if (p.scheduledRecordingAt < existing.firstIsoAt) {
        (existing as { firstIsoAt: string }).firstIsoAt = p.scheduledRecordingAt;
      }
    } else {
      pendingGroupsMap.set(key, {
        ownerId: p.contentOwnerId,
        ownerName: p.ownerName,
        dateKey,
        firstIsoAt: p.scheduledRecordingAt,
        pieces: [p],
      });
    }
  }
  const pendingGroups: readonly PendingGroup[] = Array.from(
    pendingGroupsMap.values(),
  ).sort((a, b) => a.firstIsoAt.localeCompare(b.firstIsoAt));

  // Suma para el badge de filtros: view custom + rango custom cuentan como 1.
  const activeFilters =
    (view !== "tabla" ? 1 : 0) +
    (view === "tabla" && (rangeParam !== "todo" || isCustom) ? 1 : 0);

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
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

      <KgPageFilters activeCount={activeFilters}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <KgViewToggle
            active={view}
            options={[
              {
                value: "tabla",
                label: "Vista tabla",
                icon: <IconTable size={16} />,
                href: buildViewHref("tabla", year, month),
              },
              {
                value: "calendario",
                label: "Vista calendario",
                icon: <IconCalendar size={16} />,
                href: buildViewHref("calendario", year, month),
              },
            ]}
          />
          {view === "tabla" && (
            <RangePills
              presets={RANGE_PRESETS}
              activePreset={isCustom ? null : rangeParam === "custom" ? null : rangeParam}
              activeFrom={period?.fromYmd ?? null}
              activeTo={period?.toYmd ?? null}
              baseHref="/marketing/grabacion"
            />
          )}
        </div>
      </KgPageFilters>

      {pendingGroups.length > 0 && (
        <Panel title={`Pieces con fecha sin sesión (${pendingGroups.length})`}>
          <PendingPiecesPanel
            groups={pendingGroups}
            ownerOptions={ownerOptions}
            personOptions={personOptions}
            pieceOptions={pieceOptions}
          />
        </Panel>
      )}

      <Panel
        title={view === "tabla" ? "Sesiones planificadas" : "Calendario mensual"}
        pad={false}
        fillHeight
        actions={
          <NewSessionButton
            ownerOptions={ownerOptions}
            personOptions={personOptions}
            pieceOptions={pieceOptions}
          />
        }
      >
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

function parseRange(v: string | string[] | undefined): RangeParam {
  if (typeof v !== "string") return "todo";
  const allowed: RangeParam[] = [
    "todo",
    "mes-actual",
    "mes-anterior",
    "90d",
    "custom",
  ];
  return (allowed as string[]).includes(v) ? (v as RangeParam) : "todo";
}

function parseYmd(v: string | string[] | undefined): string | null {
  if (typeof v !== "string") return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/**
 * "YYYY-MM-DD" + N días → "YYYY-MM-DD" en calendario UTC. Se usa para armar
 * el borde superior exclusivo de la query de scheduled_at (`< toYmd+1 day`)
 * y así cubrir el día completo, no cortar a las 00:00 del último día.
 */
function addDaysYmd(ymd: string, delta: number): string {
  const parts = ymd.split("-").map((n) => Number.parseInt(n, 10));
  const d = new Date(Date.UTC(parts[0] ?? 0, (parts[1] ?? 1) - 1, parts[2] ?? 1));
  d.setUTCDate(d.getUTCDate() + delta);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
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

/**
 * ISO timestamptz → YYYY-MM-DD en tz local. Se usa para agrupar pieces por
 * "día calendario del server" — misma decisión que el resto del módulo, que
 * guarda scheduled_at como timestamptz sin distinguir tz del usuario.
 */
function toLocalYmd(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
