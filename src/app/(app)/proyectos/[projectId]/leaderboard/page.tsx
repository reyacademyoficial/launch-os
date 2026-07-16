import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FiltersBar } from "@/components/dashboard/leaderboard/filters-bar";
import { LeaderboardTable } from "@/components/dashboard/leaderboard/leaderboard-table";
import { ProductBreakdownTable } from "@/components/dashboard/leaderboard/product-breakdown-table";
import {
  listCommissionRules,
  listPaymentModalities,
} from "@/lib/commissions/list";
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
import {
  requireSessionProfile,
  userCanEditLaunchesIn,
} from "@/lib/supabase/auth";
import { listTeamMembers } from "@/lib/team/list";

import { createPayout, deletePayout } from "./actions";

export const metadata: Metadata = { title: "Ranking" };

function strParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function LeaderboardPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ projectId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;

  // Cliente fuera del CRM — bouncear acá para que no quede colgado en una
  // página vacía si el link se filtra (la nav ya lo oculta).
  const profile = await requireSessionProfile();
  if (profile.role === "cliente") redirect(`/proyectos/${projectId}`);

  const launchId = strParam(sp.launchId);
  const dateFrom = strParam(sp.from);
  const dateTo = strParam(sp.to);

  const commonFilters = {
    launchId: launchId || null,
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
  };

  // Pull pre-agregado via RPCs de migración 0046. Reemplaza el pull crudo de
  // leads + sales + payments que traía 100k+ filas y demoraba minutos. Todo
  // el filtrado por launch/período ya viene aplicado desde Postgres.
  const [
    teamMembers,
    leadStats,
    saleStats,
    rules,
    launches,
    payouts,
    products,
    canEdit,
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
    userCanEditLaunchesIn(projectId),
  ]);

  // listPaymentModalities solo lo necesitamos si quisiéramos mostrar regla por
  // miembro. Para esta versión no — el agregador deriva todo internamente.
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

  // Index payouts por team_member_id para alimentar al modal (que ofrece un
  // "ver todos los lanzamientos" — necesita el historial completo del miembro,
  // no el filtrado).
  const payoutsByMember: Record<string, TeamMemberPayoutRow[]> = {};
  for (const p of payouts) {
    const arr = payoutsByMember[p.team_member_id];
    if (arr) arr.push(p);
    else payoutsByMember[p.team_member_id] = [p];
  }

  // Totales agregados para el header (suma de todas las filas filtradas).
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
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Ranking</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Ranking del equipo. La comisión se calcula sobre lo efectivamente
          cobrado y se recalcula con cada cobro. Los pagos registrados al
          miembro se restan para mostrar el saldo pendiente.
        </p>
      </header>

      <FiltersBar
        launches={launches.map((l) => ({ id: l.id, name: l.name }))}
        initial={{ launchId, dateFrom, dateTo }}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Card label="Leads trabajados" value={fmtNumber(totals.leads)} />
        <Card label="Cerrados" value={fmtNumber(totals.closed)} />
        <Card label="Revenue cobrado" value={fmtMoney(totals.revenue)} />
        <Card
          label="Comisión total"
          value={fmtMoney(totals.commission)}
          accent
        />
        <Card label="Pagado al equipo" value={fmtMoney(totals.paid)} />
        <Card
          label={totals.pending < 0 ? "A favor del equipo" : "Pendiente"}
          value={fmtMoney(Math.abs(totals.pending))}
          tone={totals.pending > 0 ? "warning" : "success"}
        />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-surface/40 p-8 text-center">
          <p className="text-sm text-fg-muted">
            No hay team members cargados todavía.
          </p>
        </div>
      ) : (
        <LeaderboardTable
          rows={rows}
          payoutsByMember={payoutsByMember}
          launches={launches.map((l) => ({ id: l.id, name: l.name }))}
          activeLaunchId={launchId}
          canEdit={canEdit}
          createPayoutAction={createPayoutAction}
          deletePayoutAction={deletePayoutAction}
        />
      )}

      <ProductBreakdownTable rows={productBreakdown} />
    </section>
  );
}

function Card({
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
  const toneClass =
    tone === "warning"
      ? "border-warning/40 bg-warning/5"
      : tone === "success"
        ? "border-success/40 bg-success/5"
        : accent
          ? "border-accent/40 bg-accent/5"
          : "border-border bg-surface";

  const valueClass =
    tone === "warning"
      ? "text-warning"
      : tone === "success"
        ? "text-success"
        : accent
          ? "text-accent"
          : "text-fg";

  return (
    <div className={"rounded-md border p-4 " + toneClass}>
      <div className="text-xs uppercase tracking-wide text-fg-subtle">
        {label}
      </div>
      <div className={"mt-2 text-xl font-bold " + valueClass}>{value}</div>
    </div>
  );
}
