import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconOrg } from "@/components/kg/icons";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";
import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

import { TeamsView, type TeamRowData } from "./teams-view";

export const metadata: Metadata = { title: "Equipos" };

type ShowFilter = "active" | "inactive" | "all";

const SHOW_OPTIONS: ReadonlyArray<{ value: ShowFilter; label: string }> = [
  { value: "active", label: "Activos" },
  { value: "inactive", label: "Archivados" },
  { value: "all", label: "Todos" },
];

interface TeamDbRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly active: boolean;
}

interface MembershipLink {
  readonly team_id: string;
  readonly active: boolean;
}

export default async function EquiposPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Los equipos son config org-level. Mismo gate que /organizacion/personas.
  await requireRole("superadmin");

  const sp = await searchParams;
  const show = parseShow(sp.show);

  const supabase = await createClient();

  const [teamsRes, membershipRes] = await Promise.all([
    supabase
      .from("teams")
      .select("id, name, description, active")
      .order("active", { ascending: false })
      .order("name", { ascending: true }),
    supabase.from("team_membership").select("team_id, active"),
  ]);

  const allTeams = (teamsRes.data ?? []) as unknown as TeamDbRow[];
  const memberships =
    (membershipRes.data ?? []) as unknown as MembershipLink[];

  const activeMembersByTeam = new Map<string, number>();
  for (const m of memberships) {
    if (!m.active) continue;
    activeMembersByTeam.set(
      m.team_id,
      (activeMembersByTeam.get(m.team_id) ?? 0) + 1,
    );
  }

  const activeCount = allTeams.filter((t) => t.active).length;
  const inactiveCount = allTeams.length - activeCount;

  const filtered = allTeams.filter((t) => {
    if (show === "active") return t.active;
    if (show === "inactive") return !t.active;
    return true;
  });

  const rows: TeamRowData[] = filtered.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    active: t.active,
    activeMembersCount: activeMembersByTeam.get(t.id) ?? 0,
  }));

  function buildHref(nextShow: ShowFilter): string {
    const params = new URLSearchParams();
    if (nextShow !== "active") params.set("show", nextShow);
    const qs = params.toString();
    return qs ? `/organizacion/equipos?${qs}` : "/organizacion/equipos";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconOrg size={16} />}
        title="Equipos"
        stats={[
          { l: "Total", v: fCount(allTeams.length) },
          { l: "Activos", v: fCount(activeCount) },
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

      <Panel title="Equipos internos">
        <TeamsView rows={rows} totalCount={rows.length} />
      </Panel>
    </div>
  );
}

function parseShow(v: string | string[] | undefined): ShowFilter {
  if (typeof v !== "string") return "active";
  if (v === "inactive" || v === "all") return v;
  return "active";
}
