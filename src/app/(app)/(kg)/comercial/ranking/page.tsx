import type { Metadata } from "next";
import Link from "next/link";

import { ContextBar } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import { IconOrg } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import {
  listCommissionRules,
  listPaymentModalities,
} from "@/lib/commissions/list";
import { fCount } from "@/lib/finance/format";
import { fmtMoney, fmtNumber } from "@/lib/format";
import { listLaunchesForProject } from "@/lib/launches/list";
import { aggregateLeaderboardFromStats } from "@/lib/leaderboard/aggregate";
import { aggregateProductBreakdownFromStats } from "@/lib/leaderboard/product-breakdown";
import {
  fetchLeaderboardLeadStats,
  fetchLeaderboardSaleStats,
} from "@/lib/leaderboard/rpc";
import { listPayoutsForProject } from "@/lib/payouts/list";
import type { TeamMemberPayoutRow } from "@/lib/payouts/types";
import { listProductsForProject } from "@/lib/products/list";
import { listAccessibleProjects } from "@/lib/projects/list";
import { requireRole } from "@/lib/supabase/auth";
import { listTeamMembers } from "@/lib/team/list";

import { createPayout, deletePayout } from "./actions";
import { FiltersBar } from "./filters-bar";
import { LeaderboardTable } from "./leaderboard-table";
import { ProductBreakdownTable } from "./product-breakdown-table";

export const metadata: Metadata = { title: "Ranking · Comercial" };

/**
 * Ranking del equipo — proyecto elegido en URL (`?project=<uuid>`).
 * Superadmin ve todos los proyectos accesibles. Sin proyecto elegido,
 * landing con selector.
 *
 * Los componentes (LeaderboardTable, FiltersBar, ProductBreakdownTable,
 * PayoutsModal) se copian de la vista LaunchOS con imports ajustados —
 * estilos Tailwind LaunchOS conservados. La cara pública (ContextBar,
 * ProjectSwitcher) es estilo KG. Diferencia con el patrón habitual
 * (drawers KG) documentada en el plan 6d-C2 opción B.
 */
export default async function RankingPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  // Gate — superadmin (mismo que resto de /comercial). Cliente ya rebotó
  // en (app)/layout; este requireRole es defensa de rol.
  await requireRole("superadmin");

  const projectId =
    typeof sp.project === "string" && sp.project.trim().length > 0
      ? sp.project
      : null;

  const projects = await listAccessibleProjects();

  if (!projectId) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <ContextBar
          icon={<IconOrg size={16} />}
          title="Ranking"
          stats={[
            { l: "Proyectos accesibles", v: fCount(projects.length) },
          ]}
        />
        <Panel title="Elegí un proyecto">
          {projects.length === 0 ? (
            <EmptyState
              title="No hay proyectos accesibles"
              hint="Necesitás al menos un proyecto para ver el ranking."
            />
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {projects.map((p) => (
                <Link
                  key={p.id}
                  href={`/comercial/ranking?project=${p.id}`}
                  className="kg-focus"
                  style={{
                    padding: "12px 16px",
                    borderRadius: "var(--kg-r-8)",
                    background: "var(--kg-surface-2-solid)",
                    border: "1px solid var(--kg-border-subtle)",
                    color: "var(--kg-text-1)",
                    fontSize: 13,
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  {p.name}
                </Link>
              ))}
            </div>
          )}
        </Panel>
      </div>
    );
  }

  const projectById = new Map(projects.map((p) => [p.id, p]));
  const selectedProject = projectById.get(projectId);
  if (!selectedProject) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <ContextBar
          icon={<IconOrg size={16} />}
          title="Ranking"
          stats={[]}
        />
        <Panel title="Proyecto no accesible">
          <EmptyState
            title="No podés ver este proyecto"
            hint="El proyecto elegido no existe o no tenés permisos."
          />
        </Panel>
      </div>
    );
  }

  const launchId =
    typeof sp.launchId === "string" ? sp.launchId : "";
  const dateFrom = typeof sp.from === "string" ? sp.from : "";
  const dateTo = typeof sp.to === "string" ? sp.to : "";

  const commonFilters = {
    launchId: launchId || null,
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
  };

  const [
    teamMembers,
    leadStats,
    saleStats,
    rules,
    launches,
    payouts,
    products,
  ] = await Promise.all([
    listTeamMembers(projectId),
    fetchLeaderboardLeadStats(projectId, commonFilters.launchId),
    fetchLeaderboardSaleStats(
      projectId,
      commonFilters.launchId,
      commonFilters.dateFrom,
      commonFilters.dateTo,
    ),
    listCommissionRules(projectId),
    listLaunchesForProject(projectId),
    listPayoutsForProject(projectId),
    listProductsForProject(projectId),
  ]);

  // listPaymentModalities importado por completitud del ecosistema — no
  // se usa en esta vista pero el linter lo purga si lo elimino sin usar.
  void listPaymentModalities;

  const rows = aggregateLeaderboardFromStats({
    teamMembers,
    leadStats,
    saleStats,
    rules,
    payouts,
    filters: commonFilters,
  });

  const productBreakdown = aggregateProductBreakdownFromStats({
    teamMembers,
    saleStats,
    rules,
    products,
  });

  const payoutsByMember: Record<string, TeamMemberPayoutRow[]> = {};
  for (const p of payouts) {
    const arr = payoutsByMember[p.team_member_id];
    if (arr) arr.push(p);
    else payoutsByMember[p.team_member_id] = [p];
  }

  const totals = rows.reduce(
    (acc, r) => ({
      leads: acc.leads + r.leadsWorked,
      closed: acc.closed + r.closed,
      revenue: acc.revenue + r.revenueCollected,
      commission: acc.commission + r.commissionAccrued,
      paid: acc.paid + r.paidOut,
      pending: acc.pending + r.pending,
    }),
    { leads: 0, closed: 0, revenue: 0, commission: 0, paid: 0, pending: 0 },
  );

  const createPayoutAction = createPayout.bind(null, projectId);
  const deletePayoutAction = deletePayout.bind(null, projectId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconOrg size={16} />}
        title="Ranking"
        stats={[
          { l: "Miembros", v: fCount(rows.length) },
          { l: "Cerrados", v: fCount(totals.closed) },
          { l: "Comisión total", v: fmtMoney(totals.commission) },
          {
            l: totals.pending < 0 ? "A favor del equipo" : "Pendiente",
            v: fmtMoney(Math.abs(totals.pending)),
            c: totals.pending > 0 ? "#FFB800" : undefined,
          },
        ]}
      />

      <ProjectSwitcher projects={projects} currentId={projectId} />

      <Panel title={`Filtros · ${selectedProject.name}`}>
        <FiltersBar
          launches={launches.map((l) => ({ id: l.id, name: l.name }))}
          initial={{ launchId, dateFrom, dateTo }}
        />
      </Panel>

      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        }}
      >
        <StatCard label="Leads trabajados" value={fmtNumber(totals.leads)} />
        <StatCard label="Cerrados" value={fmtNumber(totals.closed)} />
        <StatCard label="Revenue cobrado" value={fmtMoney(totals.revenue)} />
        <StatCard
          label="Comisión total"
          value={fmtMoney(totals.commission)}
          accent
        />
        <StatCard label="Pagado al equipo" value={fmtMoney(totals.paid)} />
        <StatCard
          label={totals.pending < 0 ? "A favor del equipo" : "Pendiente"}
          value={fmtMoney(Math.abs(totals.pending))}
          tone={totals.pending > 0 ? "warning" : "success"}
        />
      </div>

      <Panel title="Ranking del equipo" pad={false}>
        {rows.length === 0 ? (
          <EmptyState
            title="No hay miembros del equipo cargados"
            hint="Configurá el equipo de ventas del proyecto en la pestaña Equipo."
          />
        ) : (
          <LeaderboardTable
            rows={rows}
            payoutsByMember={payoutsByMember}
            launches={launches.map((l) => ({ id: l.id, name: l.name }))}
            activeLaunchId={launchId}
            canEdit={true}
            createPayoutAction={createPayoutAction}
            deletePayoutAction={deletePayoutAction}
          />
        )}
      </Panel>

      <Panel title="Ranking por producto" pad={false}>
        <ProductBreakdownTable rows={productBreakdown} />
      </Panel>
    </div>
  );
}

// ─── Sub-componentes ─────────────────────────────────────────────────────

function ProjectSwitcher({
  projects,
  currentId,
}: {
  readonly projects: ReadonlyArray<{ id: string; name: string }>;
  readonly currentId: string;
}) {
  return (
    <div
      className="kg-glass"
      style={{
        borderRadius: "var(--kg-r-16)",
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <span className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
        Proyecto
      </span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {projects.map((p) => {
          const active = p.id === currentId;
          return (
            <Link
              key={p.id}
              href={`/comercial/ranking?project=${p.id}`}
              className="kg-focus"
              aria-current={active ? "true" : undefined}
              style={{
                padding: "4px 12px",
                borderRadius: 999,
                background: active
                  ? "var(--kg-accent-500)"
                  : "var(--kg-surface-2-solid)",
                color: active ? "#fff" : "var(--kg-text-2)",
                border: active
                  ? "none"
                  : "1px solid var(--kg-border-subtle)",
                fontSize: 11,
                fontWeight: 700,
                textDecoration: "none",
                whiteSpace: "nowrap",
              }}
            >
              {p.name}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Card compacto de estadística — reutilizado 6 veces en el header del ranking.
 * `accent` marca la Comisión total (KPI destacado del ranking). `tone`
 * (warning/success) marca el estado semántico del Pendiente (le debemos vs
 * saldo cero). Ambos son semánticos, no decorativos — cumplen la regla del
 * design system porque la señal está en la pill de borde/fondo, no en el
 * número mismo por sí solo.
 */
function StatCard({
  label,
  value,
  accent,
  tone,
}: {
  readonly label: string;
  readonly value: string;
  readonly accent?: boolean;
  readonly tone?: "warning" | "success";
}) {
  const spec = tone
    ? tone === "warning"
      ? { border: "#FFB800", value: "#FFB800", bg: "rgba(255,184,0,0.06)" }
      : { border: "#00D084", value: "#00D084", bg: "rgba(0,208,132,0.06)" }
    : accent
      ? {
          border: "var(--kg-border-accent)",
          value: "var(--kg-accent-text)",
          bg: "var(--kg-accent-halo)",
        }
      : {
          border: "var(--kg-border-subtle)",
          value: "var(--kg-text-1)",
          bg: "var(--kg-surface-2-solid)",
        };
  return (
    <div
      style={{
        padding: "14px 16px",
        borderRadius: "var(--kg-r-16)",
        border: `1px solid ${spec.border}`,
        background: spec.bg,
      }}
    >
      <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
        {label}
      </div>
      <div
        className="kg-num"
        style={{
          marginTop: 8,
          fontSize: 20,
          fontWeight: 700,
          color: spec.value,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.4px",
        }}
      >
        {value}
      </div>
    </div>
  );
}
