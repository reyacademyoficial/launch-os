import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconMkt } from "@/components/kg/icons";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";
import { createClient } from "@/lib/supabase/server";

import { DuenosView, type OwnerRowData } from "./duenos-view";

export const metadata: Metadata = { title: "Marketing · Dueños" };

// ═══════════════════════════════════════════════════════════════════════════
// Listado de content_owners.
//
// Filtro por estado vía ?show=active|inactive|all (default active). Mismo
// patrón que /clientes y /organizacion/personas.
//
// Cadences count por owner viene de un fetch aparte a publishing_cadences
// (agrupamos en TS por content_owner_id). Sin RPC — con decenas de dueños
// es un fetch chico.
// ═══════════════════════════════════════════════════════════════════════════

type ShowFilter = "active" | "inactive" | "all";

const SHOW_OPTIONS: ReadonlyArray<{ value: ShowFilter; label: string }> = [
  { value: "active", label: "Activos" },
  { value: "inactive", label: "Archivados" },
  { value: "all", label: "Todos" },
];

interface OwnerDbRow {
  readonly id: string;
  readonly name: string;
  readonly handle_instagram: string | null;
  readonly handle_facebook: string | null;
  readonly handle_tiktok: string | null;
  readonly handle_youtube: string | null;
  readonly notes: string | null;
  readonly active: boolean;
}

interface CadenceLink {
  readonly content_owner_id: string;
}

export default async function DuenosPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const show = parseShow(sp.show);

  const supabase = await createClient();

  const [ownersRes, cadencesRes] = await Promise.all([
    supabase
      .from("content_owners")
      .select(
        "id, name, handle_instagram, handle_facebook, handle_tiktok, handle_youtube, notes, active",
      )
      .order("active", { ascending: false })
      .order("name", { ascending: true }),
    supabase.from("publishing_cadences").select("content_owner_id"),
  ]);

  const allOwners = (ownersRes.data ?? []) as unknown as OwnerDbRow[];
  const cadenceLinks = (cadencesRes.data ?? []) as unknown as CadenceLink[];

  const cadencesByOwner = new Map<string, number>();
  for (const link of cadenceLinks) {
    cadencesByOwner.set(
      link.content_owner_id,
      (cadencesByOwner.get(link.content_owner_id) ?? 0) + 1,
    );
  }

  const activeCount = allOwners.filter((o) => o.active).length;
  const inactiveCount = allOwners.length - activeCount;

  const filtered = allOwners.filter((o) => {
    if (show === "active") return o.active;
    if (show === "inactive") return !o.active;
    return true;
  });

  const rows: OwnerRowData[] = filtered.map((o) => ({
    id: o.id,
    name: o.name,
    handleInstagram: o.handle_instagram,
    handleFacebook: o.handle_facebook,
    handleTiktok: o.handle_tiktok,
    handleYoutube: o.handle_youtube,
    notes: o.notes,
    active: o.active,
    cadencesCount: cadencesByOwner.get(o.id) ?? 0,
  }));

  function buildHref(nextShow: ShowFilter): string {
    const params = new URLSearchParams();
    if (nextShow !== "active") params.set("show", nextShow);
    const qs = params.toString();
    return qs ? `/marketing/duenos?${qs}` : "/marketing/duenos";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconMkt size={16} />}
        title="Dueños de contenido"
        stats={[
          { l: "Total", v: fCount(allOwners.length) },
          { l: "Activos", v: fCount(activeCount) },
          { l: "Archivados", v: fCount(inactiveCount) },
          { l: "Con cadencias", v: fCount(cadencesByOwner.size) },
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

      <Panel title="Cuentas / marcas gestionadas">
        <DuenosView rows={rows} totalCount={rows.length} />
      </Panel>
    </div>
  );
}

function parseShow(v: string | string[] | undefined): ShowFilter {
  if (typeof v !== "string") return "active";
  if (v === "inactive" || v === "all") return v;
  return "active";
}
