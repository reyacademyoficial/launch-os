import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { KgFilterSelect } from "@/components/kg/filter-select";
import { IconCamera } from "@/components/kg/icons";
import { KgPageFilters } from "@/components/kg/page-menu";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";
import { computeCoverageAlerts } from "@/lib/marketing/alerts";
import {
  computeAssetStockStates,
  computeDaysOfCoverage,
  computeStockByOwnerPlatformFormat,
  minDaysOfCoverage,
  totalStock,
  type StockAssetInput,
  type StockCadenceInput,
  type StockUploadInput,
  type AssetStockState,
} from "@/lib/marketing/stock";
import {
  isMarketingFormat,
  isMarketingPlatform,
  type MarketingFormat,
  type MarketingPlatform,
} from "@/lib/marketing/types";
import { createClient } from "@/lib/supabase/server";

import { InventoryTable, type AssetInventoryRow } from "./inventory-table";

export const metadata: Metadata = { title: "Producción · Stock" };

// ═══════════════════════════════════════════════════════════════════════════
// Bloque 6 · Stock y alertas de cobertura.
//
// KPIs de cobertura en el ContextBar (stock total, días mínimos, alertas) +
// inventario individual de cortes con su estado frente al stock. Filtros:
//   ?owner=<uuid>|all         — default 'all'
//   ?onlyActive=1|0           — default 1 (solo dueños activos)
// ═══════════════════════════════════════════════════════════════════════════

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
  readonly created_at: string;
  readonly drive_asset_url: string | null;
  readonly source_content_edit_id: string | null;
}

interface UploadLite {
  readonly content_asset_id: string;
  readonly platform: string;
  readonly status: string;
}

interface CadenceLite {
  readonly content_owner_id: string;
  readonly platform: string;
  readonly format: string;
  readonly times_count: number;
  readonly period_days: number;
  readonly allow_repeat_asset: boolean;
}

export default async function StockPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const ownerFilter = parseSingle(sp.owner);
  const onlyActive = parseOnlyActive(sp.onlyActive);

  const supabase = await createClient();
  const [ownersRes, assetsRes, uploadsRes, cadencesRes] = await Promise.all([
    supabase
      .from("content_owners")
      .select("id, name, active")
      .order("name", { ascending: true }),
    supabase
      .from("content_assets")
      .select(
        "id, content_owner_id, name, format, edited_at, created_at, drive_asset_url, source_content_edit_id",
      ),
    supabase
      .from("content_uploads")
      .select("content_asset_id, platform, status"),
    supabase
      .from("publishing_cadences")
      .select(
        "content_owner_id, platform, format, times_count, period_days, allow_repeat_asset",
      ),
  ]);

  const owners = (ownersRes.data ?? []) as unknown as OwnerLite[];
  const assetsRaw = (assetsRes.data ?? []) as unknown as AssetLite[];
  const uploadsRaw = (uploadsRes.data ?? []) as unknown as UploadLite[];
  const cadencesRaw = (cadencesRes.data ?? []) as unknown as CadenceLite[];

  const ownersById = new Map<string, OwnerLite>();
  for (const o of owners) ownersById.set(o.id, o);

  const assets: StockAssetInput[] = assetsRaw
    .filter((a): a is AssetLite & { readonly format: MarketingFormat } =>
      isMarketingFormat(a.format),
    )
    .map((a) => ({
      id: a.id,
      contentOwnerId: a.content_owner_id,
      format: a.format,
      editedAt: a.edited_at,
    }));

  const uploads: StockUploadInput[] = uploadsRaw
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
      timesCount: c.times_count,
      periodDays: c.period_days,
      allowRepeatAsset: c.allow_repeat_asset,
    }));

  // ─── Cálculos derivados de los selectores puros.
  const stockBuckets = computeStockByOwnerPlatformFormat(assets, uploads, cadences);
  const coverage = computeDaysOfCoverage(stockBuckets, cadences);
  const alerts = computeCoverageAlerts(coverage);
  const totalStockCount = totalStock(stockBuckets);
  const minDays = minDaysOfCoverage(coverage);
  const criticalCount = alerts.filter((a) => a.severity === "critical").length;
  const warningCount = alerts.filter((a) => a.severity === "warning").length;

  // ─── Inventario individual: qué corte concreto hay y en qué estado está
  // frente al stock (en cola, disponible, reservado, utilizado).
  const assetStates = computeAssetStockStates(assets, uploads);

  const validAssets = assetsRaw.filter(
    (a): a is AssetLite & { readonly format: MarketingFormat } =>
      isMarketingFormat(a.format),
  );

  // Assets agrupados por edición de origen — permite mostrar "de esta
  // edición salieron otros N archivos" en el detalle, sin tener que ir a
  // buscarlo a /marketing/edicion.
  const assetsByEditId = new Map<string, { id: string; name: string }[]>();
  for (const a of validAssets) {
    if (!a.source_content_edit_id) continue;
    const arr = assetsByEditId.get(a.source_content_edit_id) ?? [];
    arr.push({ id: a.id, name: a.name });
    assetsByEditId.set(a.source_content_edit_id, arr);
  }

  const inventoryAll: AssetInventoryRow[] = validAssets.map((a) => ({
    id: a.id,
    name: a.name,
    contentOwnerId: a.content_owner_id,
    ownerName:
      ownersById.get(a.content_owner_id)?.name ?? "(dueño desconocido)",
    format: a.format,
    state: assetStates.get(a.id) ?? "en_cola",
    createdAt: a.created_at,
    driveAssetUrl: a.drive_asset_url,
    sourceContentEditId: a.source_content_edit_id,
    siblings: a.source_content_edit_id
      ? (assetsByEditId.get(a.source_content_edit_id) ?? []).filter(
          (s) => s.id !== a.id,
        )
      : [],
  }));

  const inventory = inventoryAll
    .filter((r) => {
      if (ownerFilter && r.contentOwnerId !== ownerFilter) return false;
      if (onlyActive && !ownersById.get(r.contentOwnerId)?.active) return false;
      return true;
    })
    // Lo accionable primero: disponible → reservado → en cola → utilizado.
    .sort((a, b) => {
      const rank: Record<AssetStockState, number> = {
        disponible: 0,
        reservado: 1,
        en_cola: 2,
        utilizado: 3,
      };
      const d = rank[a.state] - rank[b.state];
      if (d !== 0) return d;
      return b.createdAt.localeCompare(a.createdAt);
    });

  const availableCount = inventory.filter(
    (r) => r.state === "disponible",
  ).length;
  const reservedCount = inventory.filter((r) => r.state === "reservado").length;
  const queuedCount = inventory.filter((r) => r.state === "en_cola").length;
  const usedCount = inventory.filter((r) => r.state === "utilizado").length;

  const ownerIdsWithCadences = new Set(cadences.map((c) => c.contentOwnerId));
  const ownerFilterOptions = owners.filter(
    (o) => (o.active || ownerIdsWithCadences.has(o.id)),
  );

  function buildHref(overrides: Partial<{
    owner: string | null;
    onlyActive: boolean;
  }>): string {
    const params = new URLSearchParams();
    const nextOwner = "owner" in overrides ? overrides.owner : ownerFilter;
    const nextOnly = "onlyActive" in overrides ? overrides.onlyActive : onlyActive;
    if (nextOwner) params.set("owner", nextOwner);
    if (nextOnly === false) params.set("onlyActive", "0");
    const qs = params.toString();
    return qs ? `/marketing/stock?${qs}` : "/marketing/stock";
  }

  const activeFilters =
    (onlyActive === false ? 1 : 0) + (ownerFilter != null ? 1 : 0);

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <ContextBar
        icon={<IconCamera size={16} />}
        title="Stock de contenido"
        stats={[
          { l: "Assets en stock", v: fCount(totalStockCount) },
          {
            l: "Días mínimos",
            v: minDays == null ? "—" : String(minDays),
          },
          { l: "Alertas críticas", v: fCount(criticalCount) },
          { l: "Alertas warning", v: fCount(warningCount) },
        ]}
      />

      <KgPageFilters activeCount={activeFilters}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div
              className="kg-t7"
              style={{ color: "var(--kg-text-3)", fontWeight: 600, marginBottom: 6 }}
            >
              Alcance
            </div>
            <KgParamPills
              ariaLabel="Filtrar por estado del dueño"
              options={[
                {
                  label: "Solo activos",
                  href: buildHref({ onlyActive: true }),
                  active: onlyActive,
                },
                {
                  label: "Incluir archivados",
                  href: buildHref({ onlyActive: false }),
                  active: !onlyActive,
                },
              ]}
            />
          </div>
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
        title={`Contenido producido (${inventory.length})`}
        actions={
          <span className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
            {availableCount} disponible{availableCount === 1 ? "" : "s"} ·{" "}
            {reservedCount} reservado{reservedCount === 1 ? "" : "s"} ·{" "}
            {queuedCount} en cola · {usedCount} utilizado
            {usedCount === 1 ? "" : "s"}
          </span>
        }
        pad={false}
      >
        <InventoryTable rows={inventory} />
      </Panel>
    </div>
  );
}

function parseSingle(v: string | string[] | undefined): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function parseOnlyActive(v: string | string[] | undefined): boolean {
  if (typeof v !== "string") return true;
  return v !== "0";
}
