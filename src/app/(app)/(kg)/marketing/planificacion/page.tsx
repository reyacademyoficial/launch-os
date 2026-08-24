import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconMkt } from "@/components/kg/icons";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";
import {
  CATEGORY_LABEL,
  FORMAT_LABEL,
  isMarketingCategory,
  isMarketingFormat,
  isMarketingPlatform,
  isMarketingStage,
  MARKETING_CATEGORIES,
  MARKETING_FORMATS,
  MARKETING_STAGES,
  STAGE_LABEL,
  type MarketingCategory,
  type MarketingFormat,
  type MarketingPlatform,
  type MarketingStage,
} from "@/lib/marketing/types";
import { createClient } from "@/lib/supabase/server";

import {
  PlanificacionView,
  type PieceRowData,
} from "./planificacion-view";

export const metadata: Metadata = { title: "Marketing · Planificación" };

// ═══════════════════════════════════════════════════════════════════════════
// Listado de content_pieces con filtros vía searchParams.
//
//   ?stage=<stage>|open|all     — default 'open' (todos menos publicado/descartado)
//   ?owner=<uuid>|all           — default 'all'
//   ?category=<category>|all    — default 'all'
//   ?format=<format>|all        — default 'all'
//
// KgParamPills renderiza cada filtro como una barra horizontal. Sin
// paginación por ahora — cuando el módulo crezca, se agrega igual que
// finanza/gastos.
// ═══════════════════════════════════════════════════════════════════════════

type StageFilter = MarketingStage | "open" | "all";

interface OwnerLite {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
}

interface PieceDbRow {
  readonly id: string;
  readonly content_owner_id: string;
  readonly title: string;
  readonly script_md: string | null;
  readonly category: string;
  readonly format: string;
  readonly platforms: readonly string[] | null;
  readonly scheduled_recording_at: string | null;
  readonly scheduled_publish_at: string | null;
  readonly stage: string;
  readonly recording_session_id: string | null;
  readonly is_daily_recurring: boolean;
  readonly notes: string | null;
}

export default async function PlanificacionPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const stageFilter = parseStageFilter(sp.stage);
  const ownerFilter = parseSingle(sp.owner);
  const categoryFilter = parseCategoryFilter(sp.category);
  const formatFilter = parseFormatFilter(sp.format);

  const supabase = await createClient();

  const [ownersRes, piecesRes] = await Promise.all([
    supabase
      .from("content_owners")
      .select("id, name, active")
      .order("name", { ascending: true }),
    supabase
      .from("content_pieces")
      .select(
        "id, content_owner_id, title, script_md, category, format, platforms, scheduled_recording_at, scheduled_publish_at, stage, recording_session_id, is_daily_recurring, notes",
      )
      .order("scheduled_publish_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false }),
  ]);

  const owners = (ownersRes.data ?? []) as unknown as OwnerLite[];
  const pieces = (piecesRes.data ?? []) as unknown as PieceDbRow[];

  const ownersById = new Map<string, OwnerLite>();
  for (const o of owners) ownersById.set(o.id, o);

  const ownerOptions = owners
    .filter((o) => o.active)
    .map((o) => ({ id: o.id, name: o.name }));

  // Ownership visible en el filtro: incluimos también owners archivados que
  // tengan pieces (no queremos "esconder" filas cuyo owner ya no está
  // activo). Con ~decenas de dueños, un Set + filter es más que suficiente.
  const ownerIdsWithPieces = new Set(pieces.map((p) => p.content_owner_id));
  const ownerFilterOptions = owners.filter(
    (o) => o.active || ownerIdsWithPieces.has(o.id),
  );

  // ─── Normalizar + validar (los enums vienen de DB con CHECK constraint,
  // ─── pero el TS del archivo autogenerado los devuelve como string).
  const normalized: PieceRowData[] = pieces
    .filter(
      (p): p is PieceDbRow & {
        readonly category: MarketingCategory;
        readonly format: MarketingFormat;
        readonly stage: MarketingStage;
      } =>
        isMarketingCategory(p.category) &&
        isMarketingFormat(p.format) &&
        isMarketingStage(p.stage),
    )
    .map((p) => {
      const platforms = (p.platforms ?? []).filter(
        (x): x is MarketingPlatform => isMarketingPlatform(x),
      );
      return {
        id: p.id,
        contentOwnerId: p.content_owner_id,
        ownerName:
          ownersById.get(p.content_owner_id)?.name ?? "(dueño desconocido)",
        title: p.title,
        scriptMd: p.script_md,
        category: p.category,
        format: p.format,
        platforms,
        scheduledRecordingAt: p.scheduled_recording_at,
        scheduledPublishAt: p.scheduled_publish_at,
        stage: p.stage,
        recordingSessionId: p.recording_session_id,
        isDailyRecurring: p.is_daily_recurring,
        notes: p.notes,
      };
    });

  // ─── Filtros post-fetch. Con volúmenes iniciales alcanza; si el módulo
  // ─── crece, se mueven a la query (eq/in) para evitar traer todo.
  const filtered = normalized.filter((r) => {
    if (stageFilter === "open") {
      if (r.stage === "publicado" || r.stage === "descartado") return false;
    } else if (stageFilter !== "all" && r.stage !== stageFilter) {
      return false;
    }
    if (ownerFilter && r.contentOwnerId !== ownerFilter) return false;
    if (categoryFilter !== "all" && r.category !== categoryFilter) return false;
    if (formatFilter !== "all" && r.format !== formatFilter) return false;
    return true;
  });

  // ─── Stats para el ContextBar (usa el universo total, no el filtrado).
  const totalCount = normalized.length;
  const openCount = normalized.filter(
    (r) => r.stage !== "publicado" && r.stage !== "descartado",
  ).length;
  const publishedCount = normalized.filter(
    (r) => r.stage === "publicado",
  ).length;
  const dailyCount = normalized.filter((r) => r.isDailyRecurring).length;

  // ─── Helpers de link para KgParamPills — preservan otros filtros al
  // ─── cambiar uno solo.
  function buildHref(overrides: Partial<{
    stage: StageFilter;
    owner: string | null;
    category: MarketingCategory | "all";
    format: MarketingFormat | "all";
  }>): string {
    const params = new URLSearchParams();
    const nextStage = overrides.stage ?? stageFilter;
    const nextOwner = "owner" in overrides ? overrides.owner : ownerFilter;
    const nextCategory = overrides.category ?? categoryFilter;
    const nextFormat = overrides.format ?? formatFilter;

    if (nextStage !== "open") params.set("stage", nextStage);
    if (nextOwner) params.set("owner", nextOwner);
    if (nextCategory !== "all") params.set("category", nextCategory);
    if (nextFormat !== "all") params.set("format", nextFormat);

    const qs = params.toString();
    return qs ? `/marketing/planificacion?${qs}` : "/marketing/planificacion";
  }

  const stageOptions: ReadonlyArray<{ value: StageFilter; label: string }> = [
    { value: "open", label: "Abiertas" },
    { value: "all", label: "Todas" },
    ...MARKETING_STAGES.map((s) => ({ value: s, label: STAGE_LABEL[s] })),
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconMkt size={16} />}
        title="Planificación de contenido"
        stats={[
          { l: "Total", v: fCount(totalCount) },
          { l: "Abiertas", v: fCount(openCount) },
          { l: "Publicadas", v: fCount(publishedCount) },
          { l: "Diarias recurrentes", v: fCount(dailyCount) },
        ]}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <KgParamPills
          ariaLabel="Filtrar por estado"
          options={stageOptions.map((o) => ({
            label: o.label,
            href: buildHref({ stage: o.value }),
            active: stageFilter === o.value,
          }))}
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

        <KgParamPills
          ariaLabel="Filtrar por categoría"
          options={[
            {
              label: "Todas las categorías",
              href: buildHref({ category: "all" }),
              active: categoryFilter === "all",
            },
            ...MARKETING_CATEGORIES.map((c) => ({
              label: CATEGORY_LABEL[c],
              href: buildHref({ category: c }),
              active: categoryFilter === c,
            })),
          ]}
        />

        <KgParamPills
          ariaLabel="Filtrar por formato"
          options={[
            {
              label: "Todos los formatos",
              href: buildHref({ format: "all" }),
              active: formatFilter === "all",
            },
            ...MARKETING_FORMATS.map((f) => ({
              label: FORMAT_LABEL[f],
              href: buildHref({ format: f }),
              active: formatFilter === f,
            })),
          ]}
        />
      </div>

      <Panel title="Plan editorial">
        <PlanificacionView rows={filtered} ownerOptions={ownerOptions} />
      </Panel>
    </div>
  );
}

function parseStageFilter(v: string | string[] | undefined): StageFilter {
  if (typeof v !== "string") return "open";
  if (v === "all" || v === "open") return v;
  if (isMarketingStage(v)) return v;
  return "open";
}

function parseSingle(v: string | string[] | undefined): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function parseCategoryFilter(
  v: string | string[] | undefined,
): MarketingCategory | "all" {
  if (typeof v !== "string") return "all";
  if (isMarketingCategory(v)) return v;
  return "all";
}

function parseFormatFilter(
  v: string | string[] | undefined,
): MarketingFormat | "all" {
  if (typeof v !== "string") return "all";
  if (isMarketingFormat(v)) return v;
  return "all";
}
