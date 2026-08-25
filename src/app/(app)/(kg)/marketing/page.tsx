import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import type { HeroKpiTone } from "@/components/kg/hero-kpi";
import { IconMkt } from "@/components/kg/icons";
import { KgDataTable, type Column } from "@/components/kg/data-table";
import { Panel } from "@/components/kg/panel";
import { StateDot } from "@/components/kg/state-dot";
import { StatusPill } from "@/components/kg/status-pill";
import type { KgTone } from "@/components/kg/tone";
import { fCount } from "@/lib/finance/format";
import {
  computeEditorLoadByWeek,
  mondayOf,
} from "@/lib/marketing/editor-load";
import {
  actionableAlerts,
  computeCoverageAlerts,
  type AlertSeverity,
  type CoverageAlert,
} from "@/lib/marketing/alerts";
import {
  computeDaysOfCoverage,
  computeStockByOwnerPlatformFormat,
  minDaysOfCoverage,
  totalStock,
  type StockAssetInput,
  type StockCadenceInput,
  type StockUploadInput,
} from "@/lib/marketing/stock";
import {
  FORMAT_LABEL,
  isMarketingFormat,
  isMarketingPlatform,
  isRecordingSessionStatus,
  isUploadStatus,
  PLATFORM_LABEL,
  UPLOAD_STATUS_LABEL,
  UPLOAD_STATUS_TONE,
  type MarketingFormat,
  type MarketingPlatform,
  type RecordingSessionStatus,
  type UploadStatus,
} from "@/lib/marketing/types";
import { createClient } from "@/lib/supabase/server";

import { MarketingHeroKpis } from "./_hero-kpis";

export const metadata: Metadata = { title: "Marketing" };

// ═══════════════════════════════════════════════════════════════════════════
// Dashboard `/marketing`.
//
// Cuatro KPIs de cabecera (`HeroKpi`) + cuatro paneles:
//   1. Alertas de cobertura (top 5 críticas/warning)
//   2. Próximas grabaciones (próximos 14 días)
//   3. Editores esta semana (load pivot chico con overload)
//   4. Últimas subidas (10 más recientes)
//
// Toda la data se recalcula server-side vía los selectores puros ya
// probados (stock, alerts, editor-load). El dashboard no introduce nueva
// lógica de negocio.
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

interface AssetLite {
  readonly id: string;
  readonly content_owner_id: string;
  readonly format: string;
  readonly edited_at: string | null;
  readonly editor_person_id: string | null;
  readonly created_at: string;
}

interface UploadLite {
  readonly id: string;
  readonly content_asset_id: string;
  readonly platform: string;
  readonly scheduled_for: string;
  readonly uploaded_at: string | null;
  readonly status: string;
  readonly public_url: string | null;
}

interface CadenceLite {
  readonly content_owner_id: string;
  readonly platform: string;
  readonly format: string;
  readonly posts_per_day: number;
  readonly allow_repeat_asset: boolean;
}

interface SessionLite {
  readonly id: string;
  readonly content_owner_id: string;
  readonly scheduled_at: string;
  readonly status: string;
  readonly location: string | null;
}

interface AvailabilityLite {
  readonly person_id: string;
  readonly date_from: string;
  readonly date_to: string;
  readonly available: boolean;
}

export default async function MarketingDashboardPage() {
  const supabase = await createClient();

  const [
    ownersRes,
    personsRes,
    assetsRes,
    uploadsRes,
    cadencesRes,
    sessionsRes,
    availRes,
  ] = await Promise.all([
    supabase
      .from("content_owners")
      .select("id, name, active"),
    supabase
      .from("organization_people")
      .select("id, full_name, active"),
    supabase
      .from("content_assets")
      .select(
        "id, content_owner_id, format, edited_at, editor_person_id, created_at",
      ),
    supabase
      .from("content_uploads")
      .select(
        "id, content_asset_id, platform, scheduled_for, uploaded_at, status, public_url",
      ),
    supabase
      .from("publishing_cadences")
      .select(
        "content_owner_id, platform, format, posts_per_day, allow_repeat_asset",
      ),
    supabase
      .from("recording_sessions")
      .select("id, content_owner_id, scheduled_at, status, location"),
    supabase
      .from("editor_availability")
      .select("person_id, date_from, date_to, available"),
  ]);

  const owners = (ownersRes.data ?? []) as unknown as OwnerLite[];
  const persons = (personsRes.data ?? []) as unknown as PersonLite[];
  const assetsRaw = (assetsRes.data ?? []) as unknown as AssetLite[];
  const uploadsRaw = (uploadsRes.data ?? []) as unknown as UploadLite[];
  const cadencesRaw = (cadencesRes.data ?? []) as unknown as CadenceLite[];
  const sessionsRaw = (sessionsRes.data ?? []) as unknown as SessionLite[];
  const availabilityRaw = (availRes.data ?? []) as unknown as AvailabilityLite[];

  const ownersById = new Map<string, OwnerLite>();
  for (const o of owners) ownersById.set(o.id, o);
  const personsById = new Map<string, PersonLite>();
  for (const p of persons) personsById.set(p.id, p);
  const assetsById = new Map<string, AssetLite>();
  for (const a of assetsRaw) assetsById.set(a.id, a);

  // ─── Stock + coverage + alertas (selectores puros).
  const stockAssets: StockAssetInput[] = assetsRaw
    .filter((a): a is AssetLite & { readonly format: MarketingFormat } =>
      isMarketingFormat(a.format),
    )
    .map((a) => ({
      id: a.id,
      contentOwnerId: a.content_owner_id,
      format: a.format,
      editedAt: a.edited_at,
    }));

  const stockUploads: StockUploadInput[] = uploadsRaw
    .filter((u): u is UploadLite & { readonly platform: MarketingPlatform } =>
      isMarketingPlatform(u.platform),
    )
    .map((u) => ({
      contentAssetId: u.content_asset_id,
      platform: u.platform,
      status: u.status,
    }));

  const cadences: StockCadenceInput[] = cadencesRaw
    .filter(
      (c): c is CadenceLite & {
        readonly platform: MarketingPlatform;
        readonly format: MarketingFormat;
      } => isMarketingPlatform(c.platform) && isMarketingFormat(c.format),
    )
    .map((c) => ({
      contentOwnerId: c.content_owner_id,
      platform: c.platform,
      format: c.format,
      postsPerDay: c.posts_per_day,
      allowRepeatAsset: c.allow_repeat_asset,
    }));

  const stockBuckets = computeStockByOwnerPlatformFormat(
    stockAssets,
    stockUploads,
    cadences,
  );
  const coverage = computeDaysOfCoverage(stockBuckets, cadences);
  const alerts = computeCoverageAlerts(coverage);
  const actionable = actionableAlerts(alerts);
  const totalStockCount = totalStock(stockBuckets);
  const minDays = minDaysOfCoverage(coverage);

  // ─── KPI: sesiones planificadas próximos 14 días.
  const now = new Date();
  const in14d = new Date(now);
  in14d.setDate(now.getDate() + 14);

  const upcomingSessions = sessionsRaw
    .filter((s): s is SessionLite & { readonly status: RecordingSessionStatus } =>
      isRecordingSessionStatus(s.status),
    )
    .filter((s) => {
      if (s.status === "cancelada" || s.status === "realizada") return false;
      const d = new Date(s.scheduled_at);
      return d.getTime() >= now.getTime() && d.getTime() <= in14d.getTime();
    })
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));

  // ─── KPI: assets editados últimos 7 días.
  const sevenAgo = new Date(now);
  sevenAgo.setDate(now.getDate() - 7);
  const editedLast7d = assetsRaw.filter((a) => {
    if (!a.edited_at) return false;
    const d = new Date(a.edited_at);
    return d.getTime() >= sevenAgo.getTime() && d.getTime() <= now.getTime();
  }).length;

  // ─── Panel: editores esta semana (planning 1 semana).
  const monday = mondayOf(toYmd(now));
  const sunday = monday ? addDays(monday, 6) : null;
  const editorIds = Array.from(
    new Set(
      assetsRaw
        .map((a) => a.editor_person_id)
        .filter((x): x is string => x != null),
    ),
  );
  const editorAssets = assetsRaw
    .filter((a) => a.editor_person_id != null)
    .map((a) => ({
      editorPersonId: a.editor_person_id!,
      bucketDate: a.edited_at ?? a.created_at,
    }));
  const availabilityInput = availabilityRaw.map((a) => ({
    personId: a.person_id,
    dateFrom: a.date_from,
    dateTo: a.date_to,
    available: a.available,
  }));
  const editorCells =
    monday && sunday
      ? computeEditorLoadByWeek(
          editorAssets,
          availabilityInput,
          monday,
          sunday,
          editorIds,
        )
      : [];

  // ─── Panel: últimas 10 subidas (por uploaded_at DESC, fallback created_at).
  const recentUploads = [...uploadsRaw]
    .filter((u): u is UploadLite & {
      readonly platform: MarketingPlatform;
      readonly status: UploadStatus;
    } => isMarketingPlatform(u.platform) && isUploadStatus(u.status))
    .sort((a, b) => {
      const av = a.uploaded_at ?? a.scheduled_for;
      const bv = b.uploaded_at ?? b.scheduled_for;
      return bv.localeCompare(av);
    })
    .slice(0, 10);

  const minDaysTone: HeroKpiTone =
    minDays == null
      ? "neutral"
      : minDays < 3
        ? "negative"
        : minDays < 7
          ? "warning"
          : "positive";

  const criticalCount = alerts.filter((a) => a.severity === "critical").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconMkt size={16} />}
        title="Marketing"
        stats={[
          { l: "Dueños", v: fCount(owners.filter((o) => o.active).length) },
          { l: "Cadencias", v: fCount(cadences.length) },
          { l: "Assets totales", v: fCount(assetsRaw.length) },
          { l: "Subidas totales", v: fCount(uploadsRaw.length) },
        ]}
      />

      {/* ═════════════════════ Fila 1 · HeroKpi × 4 ═════════════════════ */}
      <MarketingHeroKpis
        totalStockCount={totalStockCount}
        minDays={minDays}
        minDaysTone={minDaysTone}
        upcomingSessionsCount={upcomingSessions.length}
        editedLast7d={editedLast7d}
      />

      {/* ═════════════════════ Fila 2 · Alertas + Grabaciones ══════════ */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel
          title="Alertas de cobertura"
          actions={<PanelLink href="/marketing/stock" label="Ver stock" />}
        >
          <AlertsPanel alerts={actionable.slice(0, 5)} ownersById={ownersById} />
        </Panel>
        <Panel
          title="Próximas grabaciones"
          actions={<PanelLink href="/marketing/grabacion" label="Ver agenda" />}
        >
          <UpcomingSessionsPanel
            sessions={upcomingSessions.slice(0, 6)}
            ownersById={ownersById}
          />
        </Panel>
      </div>

      {/* ═════════════════════ Fila 3 · Editores + Subidas ═════════════ */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel
          title="Editores esta semana"
          actions={<PanelLink href="/marketing/edicion" label="Ver edición" />}
        >
          <EditorsPanel
            cells={editorCells}
            personsById={personsById}
          />
        </Panel>
        <Panel
          title="Últimas subidas"
          actions={<PanelLink href="/marketing/subidas" label="Ver subidas" />}
        >
          <RecentUploadsPanel
            uploads={recentUploads}
            assetsById={assetsById}
            ownersById={ownersById}
          />
        </Panel>
      </div>

      {criticalCount === 0 && actionable.length === 0 && stockAssets.length === 0 && (
        <div
          className="kg-t7"
          style={{
            padding: "14px 18px",
            borderRadius: "var(--kg-r-8)",
            background: "var(--kg-surface-2-solid)",
            border: "1px dashed var(--kg-border-subtle)",
            color: "var(--kg-text-3)",
            textAlign: "center",
          }}
        >
          El módulo está inicializado pero todavía no hay contenido en el
          pipeline. Empezá cargando dueños en <a href="/marketing/duenos" style={linkStyle}>Dueños</a>,
          cadencias en <a href="/marketing/cadencias" style={linkStyle}>Cadencias</a> y
          planificando contenido en <a href="/marketing/planificacion" style={linkStyle}>Planificación</a>.
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Sub-paneles
// ═══════════════════════════════════════════════════════════════════════════

function AlertsPanel({
  alerts,
  ownersById,
}: {
  readonly alerts: readonly CoverageAlert[];
  readonly ownersById: ReadonlyMap<string, { name: string }>;
}) {
  if (alerts.length === 0) {
    return (
      <EmptyHint text="Sin alertas activas. Todos los pares (owner × platform) con cadencia tienen ≥ 7 días de cobertura." />
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {alerts.map((a) => (
        <div
          key={`${a.contentOwnerId}::${a.platform}`}
          style={rowCard}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <StateDot tone={toneForSeverity(a.severity)} />
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ color: "var(--kg-text-1)", fontWeight: 600, fontSize: 13 }}>
                {ownersById.get(a.contentOwnerId)?.name ?? "(dueño desconocido)"}
              </span>
              <span className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
                {PLATFORM_LABEL[a.platform]} · {a.stockCount} en stock · {a.dailyRate}/día
              </span>
            </div>
          </div>
          <StatusPill
            text={`${a.daysRemaining}d`}
            tone={PILL_TONE_BY_SEVERITY[a.severity]}
          />
        </div>
      ))}
    </div>
  );
}

function UpcomingSessionsPanel({
  sessions,
  ownersById,
}: {
  readonly sessions: readonly (SessionLite & {
    readonly status: RecordingSessionStatus;
  })[];
  readonly ownersById: ReadonlyMap<string, { name: string }>;
}) {
  if (sessions.length === 0) {
    return (
      <EmptyHint text="Sin grabaciones programadas en los próximos 14 días." />
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {sessions.map((s) => (
        <div key={s.id} style={rowCard}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span
              style={{
                color: "var(--kg-text-1)",
                fontWeight: 600,
                fontSize: 13,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatDateTime(s.scheduled_at)}
            </span>
            <span className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
              {ownersById.get(s.content_owner_id)?.name ?? "(dueño desconocido)"}
              {s.location && ` · ${s.location}`}
            </span>
          </div>
          <StatusPill
            text={s.status === "confirmada" ? "Confirmada" : "Planificada"}
            tone={
              s.status === "confirmada"
                ? "var(--kg-accent-500)"
                : "var(--kg-neutral-500)"
            }
          />
        </div>
      ))}
    </div>
  );
}

function EditorsPanel({
  cells,
  personsById,
}: {
  readonly cells: ReturnType<typeof computeEditorLoadByWeek>;
  readonly personsById: ReadonlyMap<string, { full_name: string }>;
}) {
  if (cells.length === 0) {
    return <EmptyHint text="Sin editores con assets asignados esta semana." />;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {cells.map((c) => (
        <div key={c.personId} style={rowCard}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {c.overloaded && <StateDot tone="negative" />}
            <span
              style={{
                color: "var(--kg-text-1)",
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              {personsById.get(c.personId)?.full_name ?? "(persona desconocida)"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span
              style={{
                fontVariantNumeric: "tabular-nums",
                color: "var(--kg-text-1)",
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              {c.assignedAssets}
            </span>
            <span className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
              assets · {c.availableDays}d disponibles
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function RecentUploadsPanel({
  uploads,
  assetsById,
  ownersById,
}: {
  readonly uploads: readonly (UploadLite & {
    readonly platform: MarketingPlatform;
    readonly status: UploadStatus;
  })[];
  readonly assetsById: ReadonlyMap<string, AssetLite>;
  readonly ownersById: ReadonlyMap<string, { name: string }>;
}) {
  if (uploads.length === 0) {
    return <EmptyHint text="Sin subidas registradas todavía." />;
  }
  const columns: Column<UploadLite & {
    readonly platform: MarketingPlatform;
    readonly status: UploadStatus;
  }>[] = [
    {
      key: "date",
      label: "Fecha",
      render: (u) => (
        <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--kg-text-1)" }}>
          {formatDay(u.uploaded_at ?? u.scheduled_for)}
        </span>
      ),
    },
    {
      key: "platform",
      label: "Plataforma",
      render: (u) => PLATFORM_LABEL[u.platform],
    },
    {
      key: "asset",
      label: "Asset",
      render: (u) => {
        const asset = assetsById.get(u.content_asset_id);
        return (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ color: "var(--kg-text-1)", fontWeight: 600 }}>
              {asset?.content_owner_id
                ? ownersById.get(asset.content_owner_id)?.name ?? "—"
                : "—"}
            </span>
            {asset && isMarketingFormat(asset.format) && (
              <span className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
                {FORMAT_LABEL[asset.format]}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: "status",
      label: "Estado",
      render: (u) => (
        <StatusPill
          text={UPLOAD_STATUS_LABEL[u.status]}
          tone={UPLOAD_STATUS_TONE[u.status]}
        />
      ),
    },
    {
      key: "link",
      label: "",
      align: "right",
      render: (u) =>
        u.public_url ? (
          <a
            href={u.public_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "var(--kg-accent-text)",
              textDecoration: "none",
              fontSize: 11,
            }}
          >
            Ver ↗
          </a>
        ) : (
          <span style={{ color: "var(--kg-text-3)" }}>—</span>
        ),
    },
  ];
  return (
    <KgDataTable
      columns={columns}
      rows={uploads}
      rowKey={(u) => u.id}
      totalCount={uploads.length}
      emptyTitle=""
      emptyHint=""
    />
  );
}

function PanelLink({ href, label }: { readonly href: string; readonly label: string }) {
  return (
    <a
      href={href}
      style={{
        color: "var(--kg-accent-text)",
        textDecoration: "none",
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {label} ↗
    </a>
  );
}

function EmptyHint({ text }: { readonly text: string }) {
  return (
    <div
      className="kg-t7"
      style={{
        padding: "14px 18px",
        borderRadius: "var(--kg-r-8)",
        background: "var(--kg-surface-2-solid)",
        border: "1px dashed var(--kg-border-subtle)",
        color: "var(--kg-text-3)",
        textAlign: "center",
      }}
    >
      {text}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function toneForSeverity(severity: AlertSeverity): KgTone {
  if (severity === "critical") return "negative";
  if (severity === "warning") return "warning";
  return "positive";
}

const PILL_TONE_BY_SEVERITY: Record<AlertSeverity, string> = {
  critical: "var(--kg-negative-500)",
  warning: "var(--kg-warning-500)",
  ok: "var(--kg-positive-500)",
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDay(s: string): string {
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  }
  const [, m, day] = s.split("-");
  if (!m || !day) return s;
  return `${day}/${m}`;
}

function toYmd(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(ymd: string, delta: number): string {
  const parts = ymd.split("-").map((n) => Number.parseInt(n, 10));
  const d = new Date(Date.UTC(parts[0] ?? 0, (parts[1] ?? 1) - 1, parts[2] ?? 1));
  d.setUTCDate(d.getUTCDate() + delta);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

const rowCard: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  padding: "10px 14px",
  borderRadius: "var(--kg-r-8)",
  background: "var(--kg-surface-2-solid)",
  border: "1px solid var(--kg-border-subtle)",
};

const linkStyle: React.CSSProperties = {
  color: "var(--kg-accent-text)",
  textDecoration: "none",
};
