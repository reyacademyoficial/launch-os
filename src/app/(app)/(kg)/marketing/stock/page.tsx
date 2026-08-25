import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconMkt } from "@/components/kg/icons";
import { KgDataTable, type Column } from "@/components/kg/data-table";
import { KgPageFilters } from "@/components/kg/page-menu";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { StateDot } from "@/components/kg/state-dot";
import { StatusPill } from "@/components/kg/status-pill";
import type { KgTone } from "@/components/kg/tone";
import { fCount } from "@/lib/finance/format";
import {
  computeCoverageAlerts,
  DEFAULT_ALERT_THRESHOLDS,
  severityFor,
  type AlertSeverity,
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
  PLATFORM_LABEL,
  type MarketingFormat,
  type MarketingPlatform,
} from "@/lib/marketing/types";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Marketing · Stock" };

// ═══════════════════════════════════════════════════════════════════════════
// Bloque 6 · Stock y alertas de cobertura.
//
// Vista pivot (owner × platform × format) con stock, dailyRate, días de
// cobertura y severity dot. Filtros:
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
  readonly format: string;
  readonly edited_at: string | null;
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
  readonly posts_per_day: number;
  readonly allow_repeat_asset: boolean;
}

interface StockPivotRow {
  readonly contentOwnerId: string;
  readonly ownerName: string;
  readonly platform: MarketingPlatform;
  readonly format: MarketingFormat;
  readonly stockCount: number;
  readonly dailyRate: number;
  readonly daysOfCoverage: number;
  readonly severity: AlertSeverity;
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
      .select("id, content_owner_id, format, edited_at"),
    supabase
      .from("content_uploads")
      .select("content_asset_id, platform, status"),
    supabase
      .from("publishing_cadences")
      .select(
        "content_owner_id, platform, format, posts_per_day, allow_repeat_asset",
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
      postsPerDay: c.posts_per_day,
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

  // ─── Filtrado + severity por fila (dailyRate individual del bucket).
  const rows: StockPivotRow[] = stockBuckets
    .map((b) => {
      const cad = cadences.find(
        (c) =>
          c.contentOwnerId === b.contentOwnerId &&
          c.platform === b.platform &&
          c.format === b.format,
      );
      const dailyRate = cad?.postsPerDay ?? 0;
      const daysOfCoverage =
        dailyRate > 0 ? Math.floor(b.stockCount / dailyRate) : Infinity;
      return {
        contentOwnerId: b.contentOwnerId,
        ownerName:
          ownersById.get(b.contentOwnerId)?.name ?? "(dueño desconocido)",
        platform: b.platform,
        format: b.format,
        stockCount: b.stockCount,
        dailyRate,
        daysOfCoverage,
        severity: severityFor(daysOfCoverage),
      };
    })
    .filter((r) => {
      if (ownerFilter && r.contentOwnerId !== ownerFilter) return false;
      if (onlyActive) {
        const owner = ownersById.get(r.contentOwnerId);
        if (!owner?.active) return false;
      }
      return true;
    })
    .sort((a, b) => {
      // Los peor parados primero (finito antes que infinito).
      if (a.daysOfCoverage === b.daysOfCoverage) {
        return a.ownerName.localeCompare(b.ownerName);
      }
      if (!Number.isFinite(a.daysOfCoverage)) return 1;
      if (!Number.isFinite(b.daysOfCoverage)) return -1;
      return a.daysOfCoverage - b.daysOfCoverage;
    });

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

  const hasCadences = cadences.length > 0;

  const activeFilters =
    (onlyActive === false ? 1 : 0) + (ownerFilter != null ? 1 : 0);

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <ContextBar
        icon={<IconMkt size={16} />}
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
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
      </KgPageFilters>

      <Panel
        title="Cobertura por dueño × plataforma × formato"
        pad={!hasCadences}
        fillHeight
      >
        {!hasCadences ? (
          <div
            className="kg-t7"
            style={{
              padding: "18px 20px",
              borderRadius: "var(--kg-r-8)",
              background: "var(--kg-surface-2-solid)",
              border: "1px dashed var(--kg-border-subtle)",
              color: "var(--kg-text-3)",
              textAlign: "center",
            }}
          >
            Configurá cadencias en <a href="/marketing/cadencias" style={{
              color: "var(--kg-accent-text)",
              textDecoration: "none",
            }}>/marketing/cadencias</a> para que Stock pueda calcular días
            de cobertura.
          </div>
        ) : (
          <StockTable rows={rows} />
        )}
      </Panel>
    </div>
  );
}

function StockTable({ rows }: { readonly rows: readonly StockPivotRow[] }) {
  const columns: Column<StockPivotRow>[] = [
    {
      key: "owner",
      label: "Dueño",
      render: (r) => (
        <span style={{ color: "var(--kg-text-1)", fontWeight: 600 }}>
          {r.ownerName}
        </span>
      ),
    },
    {
      key: "platform",
      label: "Plataforma",
      render: (r) => PLATFORM_LABEL[r.platform],
    },
    {
      key: "format",
      label: "Formato",
      render: (r) => FORMAT_LABEL[r.format],
    },
    {
      key: "stock",
      label: "Stock",
      align: "right",
      numeric: true,
      render: (r) => (
        <span
          style={{
            color: "var(--kg-text-1)",
            fontVariantNumeric: "tabular-nums",
            fontWeight: 600,
          }}
        >
          {r.stockCount}
        </span>
      ),
    },
    {
      key: "rate",
      label: "Por día",
      align: "right",
      numeric: true,
      render: (r) => (
        <span
          style={{
            color: "var(--kg-text-2)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {r.dailyRate}
        </span>
      ),
    },
    {
      key: "days",
      label: "Días de cobertura",
      align: "right",
      numeric: true,
      render: (r) => (
        <div
          style={{
            display: "flex",
            gap: 6,
            alignItems: "center",
            justifyContent: "flex-end",
          }}
        >
          <span
            style={{
              color: "var(--kg-text-1)",
              fontVariantNumeric: "tabular-nums",
              fontWeight: 700,
            }}
          >
            {Number.isFinite(r.daysOfCoverage) ? r.daysOfCoverage : "∞"}
          </span>
          <StateDot tone={toneForRow(r.severity)} />
        </div>
      ),
    },
    {
      key: "severity",
      label: "Estado",
      render: (r) => (
        <StatusPill
          text={LABEL_BY_SEVERITY[r.severity]}
          tone={PILL_TONE[r.severity]}
        />
      ),
    },
  ];

  return (
    <KgDataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => `${r.contentOwnerId}::${r.platform}::${r.format}`}
      totalCount={rows.length}
      emptyTitle="Sin combinaciones para mostrar"
      emptyHint={`Cambiá el filtro (${DEFAULT_ALERT_THRESHOLDS.criticalUnderDays}d crítico, ${DEFAULT_ALERT_THRESHOLDS.warningUnderDays}d warning) o revisá que haya cadencias.`}
      fillHeight
    />
  );
}

const LABEL_BY_SEVERITY: Record<AlertSeverity, string> = {
  critical: "Crítico",
  warning: "En riesgo",
  ok: "Cubierto",
};

const PILL_TONE: Record<AlertSeverity, string> = {
  critical: "var(--kg-negative-500)",
  warning: "var(--kg-warning-500)",
  ok: "var(--kg-positive-500)",
};

function toneForRow(severity: AlertSeverity): KgTone {
  if (severity === "critical") return "negative";
  if (severity === "warning") return "warning";
  return "positive";
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
