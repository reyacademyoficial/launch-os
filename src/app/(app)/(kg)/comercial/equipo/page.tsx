import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconOrg } from "@/components/kg/icons";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";
import { createClient } from "@/lib/supabase/server";
import { listAllTeamMembers } from "@/lib/team/list";
import type { TeamMemberRole } from "@/lib/team/types";

import { EquipoView, type TeamMemberRowData } from "./equipo-view";

export const metadata: Metadata = { title: "Equipo · Comercial" };

type ActiveParam = "activos" | "inactivos" | "todos";

const ACTIVE_OPTIONS: ReadonlyArray<{ value: ActiveParam; label: string }> = [
  { value: "activos", label: "Activos" },
  { value: "inactivos", label: "Dados de baja" },
  { value: "todos", label: "Todos" },
];

type RoleFilterParam = TeamMemberRole | "todos";

const ROLE_FILTER_OPTIONS: ReadonlyArray<{
  value: RoleFilterParam;
  label: string;
}> = [
  { value: "todos", label: "Todos los roles" },
  { value: "setter", label: "Setters" },
  { value: "closer", label: "Closers" },
  { value: "media_buyer", label: "Media buyers" },
  { value: "manager", label: "Managers" },
  { value: "otro", label: "Otros" },
];

interface SaleCountRow {
  readonly team_member_id: string | null;
}

export default async function EquipoPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const activeParam = parseActive(sp.state);
  const roleParam = parseRole(sp.role);

  const supabase = await createClient();
  const [members, salesRes] = await Promise.all([
    listAllTeamMembers(),
    supabase.from("sales").select("team_member_id"),
  ]);
  const sales = (salesRes.data ?? []) as unknown as SaleCountRow[];

  const salesByMemberId = new Map<string, number>();
  for (const s of sales) {
    if (s.team_member_id) {
      salesByMemberId.set(
        s.team_member_id,
        (salesByMemberId.get(s.team_member_id) ?? 0) + 1,
      );
    }
  }

  const filtered = members.filter((m) => {
    if (activeParam === "activos" && !m.active) return false;
    if (activeParam === "inactivos" && m.active) return false;
    if (roleParam !== "todos" && m.role !== roleParam) return false;
    return true;
  });

  const rows: TeamMemberRowData[] = filtered.map((m) => ({
    id: m.id,
    name: m.name,
    role: m.role,
    commissionRate: m.commission_rate,
    salesCount: salesByMemberId.get(m.id) ?? 0,
    active: m.active,
  }));

  const totalCount = rows.length;
  const totalActive = rows.filter((r) => r.active).length;
  const totalSalesShown = rows.reduce((a, r) => a + r.salesCount, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconOrg size={16} />}
        title="Equipo de ventas"
        stats={[
          { l: "En la vista", v: fCount(totalCount) },
          { l: "Activos", v: fCount(totalActive) },
          { l: "Ventas asociadas", v: fCount(totalSalesShown) },
        ]}
      />

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <KgParamPills
          ariaLabel="Filtrar por estado"
          options={ACTIVE_OPTIONS.map((o) => ({
            label: o.label,
            href: buildHref({ state: o.value, role: roleParam }),
            active: activeParam === o.value,
          }))}
        />
        <KgParamPills
          ariaLabel="Filtrar por rol"
          options={ROLE_FILTER_OPTIONS.map((o) => ({
            label: o.label,
            href: buildHref({ state: activeParam, role: o.value }),
            active: roleParam === o.value,
          }))}
        />
      </div>

      <Panel title="Miembros del equipo" pad={false}>
        <EquipoView rows={rows} totalCount={totalCount} />
      </Panel>
    </div>
  );
}

function parseActive(v: string | string[] | undefined): ActiveParam {
  if (typeof v !== "string") return "activos";
  const allowed: ActiveParam[] = ["activos", "inactivos", "todos"];
  return (allowed as string[]).includes(v) ? (v as ActiveParam) : "activos";
}

function parseRole(v: string | string[] | undefined): RoleFilterParam {
  if (typeof v !== "string") return "todos";
  const allowed: RoleFilterParam[] = [
    "todos",
    "setter",
    "closer",
    "media_buyer",
    "manager",
    "otro",
  ];
  return (allowed as string[]).includes(v)
    ? (v as RoleFilterParam)
    : "todos";
}

function buildHref(overrides: {
  state: ActiveParam;
  role: RoleFilterParam;
}): string {
  const params = new URLSearchParams();
  if (overrides.state !== "activos") params.set("state", overrides.state);
  if (overrides.role !== "todos") params.set("role", overrides.role);
  const qs = params.toString();
  return qs ? `/comercial/equipo?${qs}` : "/comercial/equipo";
}
