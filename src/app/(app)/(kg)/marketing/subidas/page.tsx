import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconMkt } from "@/components/kg/icons";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";
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

  const supabase = await createClient();

  const [ownersRes, assetsRes, uploadsRes, cadencesRes] = await Promise.all([
    supabase
      .from("content_owners")
      .select("id, name, active")
      .order("name", { ascending: true }),
    supabase
      .from("content_assets")
      .select("id, content_owner_id, name, format, edited_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("content_uploads")
      .select(
        "id, content_asset_id, platform, scheduled_for, uploaded_at, status, public_url, notes",
      )
      .order("scheduled_for", { ascending: false }),
    supabase
      .from("publishing_cadences")
      .select("content_owner_id, platform, format, allow_repeat_asset"),
  ]);

  const owners = (ownersRes.data ?? []) as unknown as OwnerLite[];
  const assets = (assetsRes.data ?? []) as unknown as AssetLite[];
  const uploads = (uploadsRes.data ?? []) as unknown as UploadDbRow[];
  const cadencesRaw = (cadencesRes.data ?? []) as unknown as CadenceDbRow[];

  const ownersById = new Map<string, OwnerLite>();
  for (const o of owners) ownersById.set(o.id, o);
  const assetsById = new Map<string, AssetLite>();
  for (const a of assets) assetsById.set(a.id, a);

  // usedPlatforms por asset: platforms donde YA hay un upload en 'subida'.
  const usedByAsset = new Map<string, Set<MarketingPlatform>>();
  for (const u of uploads) {
    if (u.status !== "subida") continue;
    if (!isMarketingPlatform(u.platform)) continue;
    const set = usedByAsset.get(u.content_asset_id) ?? new Set<MarketingPlatform>();
    set.add(u.platform);
    usedByAsset.set(u.content_asset_id, set);
  }

  const ownerOptions = owners
    .filter((o) => o.active)
    .map((o) => ({ id: o.id, name: o.name }));

  const assetOptions = assets
    .filter((a): a is AssetLite & { readonly format: MarketingFormat } =>
      isMarketingFormat(a.format),
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
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

      <KgParamPills
        ariaLabel="Cambiar vista"
        options={[
          {
            label: "Tabla",
            href: buildHref({ view: "tabla" }),
            active: view === "tabla",
          },
          {
            label: "Calendario",
            href: buildHref({ view: "calendario" }),
            active: view === "calendario",
          },
        ]}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <KgParamPills
          ariaLabel="Filtrar por estado"
          options={statusOptions.map((o) => ({
            label: o.label,
            href: buildHref({ status: o.value }),
            active: statusFilter === o.value,
          }))}
        />

        <KgParamPills
          ariaLabel="Filtrar por plataforma"
          options={[
            {
              label: "Todas las plataformas",
              href: buildHref({ platform: "all" }),
              active: platformFilter === "all",
            },
            ...MARKETING_PLATFORMS.map((p) => ({
              label: PLATFORM_LABEL[p],
              href: buildHref({ platform: p }),
              active: platformFilter === p,
            })),
          ]}
        />

        {ownerFilterOptions.length > 0 && (
          <KgParamPills
            ariaLabel="Filtrar por dueño"
            options={[
              {
                label: "Todos los dueños",
                href: buildHref({ owner: null }),
                active: ownerFilter == null,
              },
              ...ownerFilterOptions.map((o) => ({
                label: o.name,
                href: buildHref({ owner: o.id }),
                active: ownerFilter === o.id,
              })),
            ]}
          />
        )}
      </div>

      <Panel
        title={
          view === "tabla" ? "Subidas planificadas" : "Calendario mensual"
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
