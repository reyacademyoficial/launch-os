import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { KgFilterSelect } from "@/components/kg/filter-select";
import { IconCalendar, IconMkt, IconTable } from "@/components/kg/icons";
import { KgPageFilters } from "@/components/kg/page-menu";
import { Panel } from "@/components/kg/panel";
import { KgViewToggle } from "@/components/kg/view-toggle";
import { fCount } from "@/lib/finance/format";
import { resolvePeriod, type Period } from "@/lib/finance/period";
import { getOrgPeople } from "@/lib/finance/reference";
import { committedPlatformsByAsset } from "@/lib/marketing/stock";
import {
  isMarketingFormat,
  isMarketingPlatform,
  isUploadStatus,
  MARKETING_PLATFORMS,
  PLATFORM_LABEL,
  UPLOAD_STATUS_LABEL,
  UPLOAD_STATUSES,
  type MarketingFormat,
  type MarketingPlatform,
  type UploadStatus,
} from "@/lib/marketing/types";
import { createClient } from "@/lib/supabase/server";

import { RangePills, type PresetOption } from "../../financiero/range-pills";

import { NewUploadButton } from "./new-upload-button";
import {
  SubidasView,
  type UploadRowData,
} from "./subidas-view";

export const metadata: Metadata = { title: "Marketing · Subidas" };

// ═══════════════════════════════════════════════════════════════════════════
// Bloque 4 · Subidas.
//
// Fetch:
//   - content_uploads (+ resolver asset → owner + format)
//   - content_assets (para el picker; incluye edited_at para etiquetar "en cola")
//   - content_owners (para picker + filtro)
//   - publishing_cadences (para el flag allow_repeat_asset del picker)
//
// Filtros vía searchParams:
//   ?view=tabla|calendario     — default 'tabla'
//   ?year=YYYY&month=MM        — solo tiene efecto en calendario, default hoy
//   ?platform=<platform>|all   — default 'all'
//   ?owner=<uuid>|all          — default 'all'
//   ?status=<status>|open|all  — default 'open' (planificada + fallida)
// ═══════════════════════════════════════════════════════════════════════════

type StatusFilter = UploadStatus | "open" | "all";
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

interface AssetLite {
  readonly id: string;
  readonly content_owner_id: string;
  readonly name: string;
  readonly format: string;
  readonly edited_at: string | null;
}

interface UploadDbRow {
  readonly id: string;
  readonly content_asset_id: string;
  readonly platform: string;
  readonly scheduled_for: string;
  readonly uploaded_at: string | null;
  readonly status: string;
  readonly public_url: string | null;
  readonly notes: string | null;
  readonly planned_by_person_id: string | null;
  readonly uploaded_by_person_id: string | null;
}

interface CadenceDbRow {
  readonly content_owner_id: string;
  readonly platform: string;
  readonly format: string;
  readonly allow_repeat_asset: boolean;
}

export default async function SubidasPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const view = parseView(sp.view);
  const { year, month } = parseMonth(sp.year, sp.month);
  const platformFilter = parsePlatformFilter(sp.platform);
  const ownerFilter = parseSingle(sp.owner);
  const statusFilter = parseStatusFilter(sp.status);
  const rangeParam = parseRange(sp.range);
  const fromParam = parseYmd(sp.from);
  const toParam = parseYmd(sp.to);

  // Rango temporal SOLO se aplica en vista tabla (en calendario navegás por mes).
  const isCustom = fromParam != null && toParam != null;
  const effectiveRange: RangeParam = isCustom ? "custom" : rangeParam;
  const period: Period | null =
    view !== "tabla" || effectiveRange === "todo"
      ? null
      : isCustom
        ? resolvePeriod({ from: fromParam, to: toParam })
        : resolvePeriod({ range: effectiveRange });

  const supabase = await createClient();

  let uploadsQuery = supabase
    .from("content_uploads")
    .select(
      "id, content_asset_id, platform, scheduled_for, uploaded_at, status, public_url, notes, planned_by_person_id, uploaded_by_person_id",
    )
    .order("scheduled_for", { ascending: false });
  if (period) {
    // scheduled_for es `date` (yyyy-mm-dd), comparación lexicográfica OK.
    uploadsQuery = uploadsQuery
      .gte("scheduled_for", period.fromYmd)
      .lte("scheduled_for", period.toYmd);
  }

  // Los uploads que alimentan el picker NO pueden venir filtrados por rango:
  // el asset se reserva por cualquier subida abierta, esté o no en el rango
  // que el usuario está mirando. Por eso el segundo fetch sin filtro.
  const [ownersRes, personsRef, assetsRes, uploadsRes, allUploadsRes, cadencesRes] =
    await Promise.all([
      supabase
        .from("content_owners")
        .select("id, name, active")
        .order("name", { ascending: true }),
      getOrgPeople(),
      supabase
        .from("content_assets")
        .select("id, content_owner_id, name, format, edited_at")
        .order("created_at", { ascending: false }),
      uploadsQuery,
      supabase
        .from("content_uploads")
        .select("content_asset_id, platform, status"),
      supabase
        .from("publishing_cadences")
        .select("content_owner_id, platform, format, allow_repeat_asset"),
    ]);

  const owners = (ownersRes.data ?? []) as unknown as OwnerLite[];
  const persons = personsRef as unknown as ReadonlyArray<{
    readonly id: string;
    readonly full_name: string;
  }>;
  const assets = (assetsRes.data ?? []) as unknown as AssetLite[];
  const uploads = (uploadsRes.data ?? []) as unknown as UploadDbRow[];
  const allUploads = (allUploadsRes.data ?? []) as unknown as ReadonlyArray<{
    readonly content_asset_id: string;
    readonly platform: string;
    readonly status: string;
  }>;
  const cadencesRaw = (cadencesRes.data ?? []) as unknown as CadenceDbRow[];

  const personNameById = new Map<string, string>();
  for (const p of persons) personNameById.set(p.id, p.full_name);

  const ownersById = new Map<string, OwnerLite>();
  for (const o of owners) ownersById.set(o.id, o);
  const assetsById = new Map<string, AssetLite>();
  for (const a of assets) assetsById.set(a.id, a);

  // Plataformas donde cada asset ya está comprometido: reservado
  // ('planificada') o consumido ('subida'). Mismo criterio que usa el stock,
  // así el picker no ofrece un corte que ya está agendado en otro lado.
  const usedByAsset = committedPlatformsByAsset(
    allUploads
      .filter((u) => isMarketingPlatform(u.platform))
      .map((u) => ({
        contentAssetId: u.content_asset_id,
        platform: u.platform as MarketingPlatform,
        status: u.status,
      })),
  );

  const ownerOptions = owners
    .filter((o) => o.active)
    .map((o) => ({ id: o.id, name: o.name }));

  // Sólo entran al picker los cortes YA EDITADOS: son los únicos que están
  // efectivamente disponibles para subir. Los que siguen en la cola de
  // edición viven en /marketing/edicion hasta que alguien los termine.
  const assetOptions = assets
    .filter((a): a is AssetLite & { readonly format: MarketingFormat } =>
      isMarketingFormat(a.format) && a.edited_at != null,
    )
    .map((a) => ({
      id: a.id,
      contentOwnerId: a.content_owner_id,
      name: a.name,
      format: a.format,
      editedAt: a.edited_at,
      usedPlatforms: Array.from(usedByAsset.get(a.id) ?? []),
    }));

  const cadences = cadencesRaw
    .filter(
      (c): c is CadenceDbRow & {
        readonly platform: MarketingPlatform;
        readonly format: MarketingFormat;
      } => isMarketingPlatform(c.platform) && isMarketingFormat(c.format),
    )
    .map((c) => ({
      contentOwnerId: c.content_owner_id,
      platform: c.platform,
      format: c.format,
      allowRepeatAsset: c.allow_repeat_asset,
    }));

  const normalized: UploadRowData[] = uploads
    .filter((u): u is UploadDbRow & {
      readonly platform: MarketingPlatform;
      readonly status: UploadStatus;
    } => isMarketingPlatform(u.platform) && isUploadStatus(u.status))
    .map((u) => {
      const asset = assetsById.get(u.content_asset_id);
      const ownerId = asset?.content_owner_id ?? "";
      const format = asset && isMarketingFormat(asset.format)
        ? asset.format
        : ("reel" as MarketingFormat);
      return {
        id: u.id,
        contentAssetId: u.content_asset_id,
        contentOwnerId: ownerId,
        ownerName: ownersById.get(ownerId)?.name ?? "(dueño desconocido)",
        assetName: asset?.name ?? "(asset desconocido)",
        assetFormat: format,
        platform: u.platform,
        scheduledFor: u.scheduled_for,
        uploadedAt: u.uploaded_at,
        status: u.status,
        publicUrl: u.public_url,
        notes: u.notes,
        plannedByName: u.planned_by_person_id
          ? personNameById.get(u.planned_by_person_id) ?? "(persona dada de baja)"
          : null,
        uploadedByName: u.uploaded_by_person_id
          ? personNameById.get(u.uploaded_by_person_id) ?? "(persona dada de baja)"
          : null,
      };
    });

  const ownerIdsWithUploads = new Set(normalized.map((r) => r.contentOwnerId));
  const ownerFilterOptions = owners.filter(
    (o) => o.active || ownerIdsWithUploads.has(o.id),
  );

  const filtered = normalized.filter((r) => {
    if (platformFilter !== "all" && r.platform !== platformFilter) return false;
    if (ownerFilter && r.contentOwnerId !== ownerFilter) return false;
    if (statusFilter === "open") {
      if (r.status !== "planificada" && r.status !== "fallida") return false;
    } else if (statusFilter !== "all" && r.status !== statusFilter) {
      return false;
    }
    return true;
  });

  const totalCount = normalized.length;
  const plannedCount = normalized.filter(
    (r) => r.status === "planificada",
  ).length;
  const uploadedCount = normalized.filter((r) => r.status === "subida").length;
  const failedCount = normalized.filter((r) => r.status === "fallida").length;

  function buildHref(overrides: Partial<{
    view: "tabla" | "calendario";
    year: number;
    month: number;
    platform: MarketingPlatform | "all";
    owner: string | null;
    status: StatusFilter;
  }>): string {
    const params = new URLSearchParams();
    const nextView = overrides.view ?? view;
    const nextYear = overrides.year ?? year;
    const nextMonth = overrides.month ?? month;
    const nextPlatform = overrides.platform ?? platformFilter;
    const nextOwner = "owner" in overrides ? overrides.owner : ownerFilter;
    const nextStatus = overrides.status ?? statusFilter;

    if (nextView !== "tabla") params.set("view", nextView);
    if (nextView === "calendario") {
      params.set("year", String(nextYear));
      params.set("month", String(nextMonth).padStart(2, "0"));
    }
    if (nextPlatform !== "all") params.set("platform", nextPlatform);
    if (nextOwner) params.set("owner", nextOwner);
    if (nextStatus !== "open") params.set("status", nextStatus);
    // Rango sólo tiene sentido en vista tabla — evita URLs contaminadas al
    // navegar entre vistas.
    if (nextView === "tabla") {
      if (isCustom && fromParam && toParam) {
        params.set("from", fromParam);
        params.set("to", toParam);
      } else if (rangeParam !== "todo") {
        params.set("range", rangeParam);
      }
    }

    const qs = params.toString();
    return qs ? `/marketing/subidas?${qs}` : "/marketing/subidas";
  }

  const statusOptions: ReadonlyArray<{ value: StatusFilter; label: string }> = [
    { value: "open", label: "Abiertas" },
    { value: "all", label: "Todas" },
    ...UPLOAD_STATUSES.map((s) => ({ value: s, label: UPLOAD_STATUS_LABEL[s] })),
  ];

  // Preservar filtros al navegar entre meses del calendario.
  const preserveParams: Record<string, string | null> = {
    view: "calendario",
  };
  if (platformFilter !== "all") preserveParams.platform = platformFilter;
  if (ownerFilter) preserveParams.owner = ownerFilter;
  if (statusFilter !== "open") preserveParams.status = statusFilter;

  // Vista tabla/calendario NO cuenta al badge — vive fuera del drawer.
  const activeFilters =
    (statusFilter !== "open" ? 1 : 0) +
    (platformFilter !== "all" ? 1 : 0) +
    (ownerFilter != null ? 1 : 0) +
    (view === "tabla" && (rangeParam !== "todo" || isCustom) ? 1 : 0);

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <ContextBar
        icon={<IconMkt size={16} />}
        title="Subidas"
        stats={[
          { l: "Total", v: fCount(totalCount) },
          { l: "Planificadas", v: fCount(plannedCount) },
          { l: "Subidas", v: fCount(uploadedCount) },
          { l: "Fallidas", v: fCount(failedCount) },
        ]}
      />

      {/* Toggle de vista — vive inline en la page, no en el drawer. */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <KgViewToggle
          active={view}
          options={[
            {
              value: "tabla",
              label: "Vista tabla",
              icon: <IconTable size={16} />,
              href: buildHref({ view: "tabla" }),
            },
            {
              value: "calendario",
              label: "Vista calendario",
              icon: <IconCalendar size={16} />,
              href: buildHref({ view: "calendario" }),
            },
          ]}
        />
      </div>

      <KgPageFilters activeCount={activeFilters}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {view === "tabla" && (
            <RangePills
              presets={RANGE_PRESETS}
              activePreset={isCustom ? null : rangeParam === "custom" ? null : rangeParam}
              activeFrom={period?.fromYmd ?? null}
              activeTo={period?.toYmd ?? null}
              baseHref="/marketing/subidas"
            />
          )}

          <KgFilterSelect
            label="Estado"
            active={statusFilter}
            options={statusOptions.map((o) => ({
              label: o.label,
              value: o.value,
              href: buildHref({ status: o.value }),
            }))}
          />

          <KgFilterSelect
            label="Plataforma"
            active={platformFilter}
            options={[
              {
                label: "Todas las plataformas",
                value: "all",
                href: buildHref({ platform: "all" }),
              },
              ...MARKETING_PLATFORMS.map((p) => ({
                label: PLATFORM_LABEL[p],
                value: p,
                href: buildHref({ platform: p }),
              })),
            ]}
          />

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
        title={
          view === "tabla" ? "Subidas planificadas" : "Calendario mensual"
        }
        pad={false}
        fillHeight
        actions={
          <NewUploadButton
            ownerOptions={ownerOptions}
            assetOptions={assetOptions}
            cadences={cadences}
          />
        }
      >
        <SubidasView
          view={view}
          rows={filtered}
          year={year}
          month={month}
          baseHref="/marketing/subidas"
          preserveParams={preserveParams}
          ownerOptions={ownerOptions}
          assetOptions={assetOptions}
          cadences={cadences}
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

function parseSingle(v: string | string[] | undefined): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function parsePlatformFilter(
  v: string | string[] | undefined,
): MarketingPlatform | "all" {
  if (typeof v !== "string") return "all";
  if (isMarketingPlatform(v)) return v;
  return "all";
}

function parseStatusFilter(
  v: string | string[] | undefined,
): StatusFilter {
  if (typeof v !== "string") return "open";
  if (v === "open" || v === "all") return v;
  if (isUploadStatus(v)) return v;
  return "open";
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
