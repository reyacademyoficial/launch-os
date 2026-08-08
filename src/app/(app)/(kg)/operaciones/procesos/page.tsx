import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconOps } from "@/components/kg/icons";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";
import { createClient } from "@/lib/supabase/server";

import {
  ProcessesView,
  type ProcessRowData,
} from "./processes-view";

export const metadata: Metadata = { title: "Procesos · Operaciones" };

type ShowFilter = "active" | "inactive" | "all";

const SHOW_OPTIONS: ReadonlyArray<{ value: ShowFilter; label: string }> = [
  { value: "active", label: "Activos" },
  { value: "inactive", label: "Archivados" },
  { value: "all", label: "Todos" },
];

interface ProcessDbRow {
  readonly id: string;
  readonly title: string;
  readonly slug: string | null;
  readonly content_md: string;
  readonly category: string | null;
  readonly version: number;
  readonly active: boolean;
  readonly updated_at: string;
}

export default async function ProcesosPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const show = parseShow(sp.show);

  const supabase = await createClient();
  const { data } = await supabase
    .from("processes")
    .select(
      "id, title, slug, content_md, category, version, active, updated_at",
    )
    .order("active", { ascending: false })
    .order("category", { ascending: true, nullsFirst: false })
    .order("title", { ascending: true });

  const allProcesses = (data ?? []) as unknown as ProcessDbRow[];
  const activeCount = allProcesses.filter((p) => p.active).length;
  const inactiveCount = allProcesses.length - activeCount;

  const filtered = allProcesses.filter((p) => {
    if (show === "active") return p.active;
    if (show === "inactive") return !p.active;
    return true;
  });

  const rows: ProcessRowData[] = filtered.map((p) => ({
    id: p.id,
    title: p.title,
    slug: p.slug,
    contentMd: p.content_md,
    category: p.category,
    version: p.version,
    active: p.active,
    updatedAt: p.updated_at,
  }));

  const uniqueCategories = new Set(
    allProcesses.filter((p) => p.category != null).map((p) => p.category),
  ).size;

  function buildHref(nextShow: ShowFilter): string {
    const params = new URLSearchParams();
    if (nextShow !== "active") params.set("show", nextShow);
    const qs = params.toString();
    return qs ? `/operaciones/procesos?${qs}` : "/operaciones/procesos";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconOps size={16} />}
        title="Procesos"
        stats={[
          { l: "Total", v: fCount(allProcesses.length) },
          { l: "Activos", v: fCount(activeCount) },
          { l: "Categorías", v: fCount(uniqueCategories) },
          { l: "Archivados", v: fCount(inactiveCount) },
        ]}
      />

      <KgParamPills
        ariaLabel="Filtrar por estado"
        options={SHOW_OPTIONS.map((o) => ({
          label: o.label,
          href: buildHref(o.value),
          active: show === o.value,
        }))}
      />

      <Panel title="Procesos operativos">
        <ProcessesView rows={rows} totalCount={rows.length} />
      </Panel>
    </div>
  );
}

function parseShow(v: string | string[] | undefined): ShowFilter {
  if (typeof v !== "string") return "active";
  if (v === "inactive" || v === "all") return v;
  return "active";
}
