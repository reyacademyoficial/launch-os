import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconCamera } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";
import {
  isMarketingFormat,
  isMarketingPlatform,
  type MarketingFormat,
  type MarketingPlatform,
} from "@/lib/marketing/types";
import { createClient } from "@/lib/supabase/server";

import { cadenceDailyRate } from "@/lib/marketing/stock";

import { CadenciasView, type CadenceRowData } from "./cadencias-view";
import { NewCadenceButton } from "./new-cadence-button";

export const metadata: Metadata = { title: "Producción · Cadencias" };

// ═══════════════════════════════════════════════════════════════════════════
// Listado de publishing_cadences.
//
// Fetch de owners activos (para el picker del drawer) + fetch de cadences
// (join por owner en TS). Ordenado por owner name, luego platform, luego
// format para que la tabla se lea de forma consistente.
// ═══════════════════════════════════════════════════════════════════════════

interface OwnerLite {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
}

interface CadenceDbRow {
  readonly content_owner_id: string;
  readonly platform: string;
  readonly format: string;
  readonly times_count: number;
  readonly period_days: number;
  readonly allow_repeat_asset: boolean;
  readonly notes: string | null;
}

export default async function CadenciasPage() {
  const supabase = await createClient();

  const [ownersRes, cadencesRes] = await Promise.all([
    supabase
      .from("content_owners")
      .select("id, name, active")
      .order("name", { ascending: true }),
    supabase
      .from("publishing_cadences")
      .select(
        "content_owner_id, platform, format, times_count, period_days, allow_repeat_asset, notes",
      ),
  ]);

  const owners = (ownersRes.data ?? []) as unknown as OwnerLite[];
  const cadences = (cadencesRes.data ?? []) as unknown as CadenceDbRow[];

  // Solo dueños activos van al picker del drawer (no queremos crear cadencias
  // nuevas sobre dueños archivados). Los inactivos que YA tengan cadencia
  // siguen apareciendo en la tabla, con el nombre resuelto por el map.
  const ownersById = new Map<string, OwnerLite>();
  for (const o of owners) ownersById.set(o.id, o);

  const ownerOptions = owners
    .filter((o) => o.active)
    .map((o) => ({ id: o.id, name: o.name }));

  const rows: CadenceRowData[] = cadences
    .filter(
      (c): c is CadenceDbRow & {
        readonly platform: MarketingPlatform;
        readonly format: MarketingFormat;
      } => isMarketingPlatform(c.platform) && isMarketingFormat(c.format),
    )
    .map((c) => ({
      contentOwnerId: c.content_owner_id,
      ownerName:
        ownersById.get(c.content_owner_id)?.name ?? "(dueño desconocido)",
      platform: c.platform,
      format: c.format,
      timesCount: c.times_count,
      periodDays: c.period_days,
      allowRepeatAsset: c.allow_repeat_asset,
      notes: c.notes,
    }))
    .sort((a, b) => {
      const byOwner = a.ownerName.localeCompare(b.ownerName);
      if (byOwner !== 0) return byOwner;
      const byPlatform = a.platform.localeCompare(b.platform);
      if (byPlatform !== 0) return byPlatform;
      return a.format.localeCompare(b.format);
    });

  const uniqueOwners = new Set(rows.map((r) => r.contentOwnerId)).size;
  const uniquePlatforms = new Set(rows.map((r) => r.platform)).size;
  const dailyTotal = rows.reduce((sum, r) => sum + cadenceDailyRate(r), 0);

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <ContextBar
        icon={<IconCamera size={16} />}
        title="Cadencias de publicación"
        stats={[
          { l: "Cadencias", v: fCount(rows.length) },
          { l: "Dueños con cadencia", v: fCount(uniqueOwners) },
          { l: "Plataformas cubiertas", v: fCount(uniquePlatforms) },
          { l: "Posts/día total", v: dailyTotal.toFixed(1) },
        ]}
      />

      <Panel
        title="Regla por dueño × plataforma × formato"
        pad={false}
        fillHeight
        actions={<NewCadenceButton ownerOptions={ownerOptions} />}
      >
        <CadenciasView rows={rows} ownerOptions={ownerOptions} />
      </Panel>
    </div>
  );
}
