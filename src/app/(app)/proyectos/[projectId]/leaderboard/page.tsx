import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FiltersBar } from "@/components/dashboard/leaderboard/filters-bar";
import { LeaderboardTable } from "@/components/dashboard/leaderboard/leaderboard-table";
import {
  listCommissionRules,
  listPaymentModalities,
} from "@/lib/commissions/list";
import { fmtMoney, fmtNumber } from "@/lib/format";
import { listLaunchesForProject } from "@/lib/launches/list";
import { aggregateLeaderboard } from "@/lib/leaderboard/aggregate";
import { listLeads } from "@/lib/leads/list";
import {
  listPaymentsForProject,
  listSalesForProject,
} from "@/lib/sales/list";
import { requireSessionProfile } from "@/lib/supabase/auth";
import { listTeamMembers } from "@/lib/team/list";

export const metadata: Metadata = { title: "Leaderboard" };

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

  const [teamMembers, leads, sales, payments, rules, launches] = await Promise.all([
    listTeamMembers(projectId),
    listLeads(projectId),
    listSalesForProject(projectId),
    listPaymentsForProject(projectId),
    listCommissionRules(projectId),
    listLaunchesForProject(projectId),
  ]);

  // listPaymentModalities solo lo necesitamos si quisiéramos mostrar regla por
  // miembro. Para esta versión no — el agregador deriva todo internamente.
  void listPaymentModalities;

  const rows = aggregateLeaderboard({
    teamMembers,
    leads,
    sales,
    payments,
    rules,
    filters: {
      launchId: launchId || null,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
    },
  });

  // Totales agregados para el header (suma de todas las filas filtradas).
  const totals = rows.reduce(
    (acc, r) => ({
      leads: acc.leads + r.leadsWorked,
      closed: acc.closed + r.closed,
      revenue: acc.revenue + r.revenueCollected,
      commission: acc.commission + r.commissionAccrued,
    }),
    { leads: 0, closed: 0, revenue: 0, commission: 0 },
  );

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Leaderboard</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Ranking del equipo. La comisión se calcula sobre lo efectivamente
          cobrado y se recalcula con cada cobro.
        </p>
      </header>

      <FiltersBar
        launches={launches.map((l) => ({ id: l.id, name: l.name }))}
        initial={{ launchId, dateFrom, dateTo }}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="Leads trabajados" value={fmtNumber(totals.leads)} />
        <Card label="Cerrados" value={fmtNumber(totals.closed)} />
        <Card label="Revenue cobrado" value={fmtMoney(totals.revenue)} />
        <Card
          label="Comisión total"
          value={fmtMoney(totals.commission)}
          accent
        />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-surface/40 p-8 text-center">
          <p className="text-sm text-fg-muted">
            No hay team members cargados todavía.
          </p>
        </div>
      ) : (
        <LeaderboardTable rows={rows} />
      )}
    </section>
  );
}

function Card({
  label,
  value,
  accent,
}: {
  readonly label: string;
  readonly value: string;
  readonly accent?: boolean;
}) {
  return (
    <div
      className={
        "rounded-md border p-4 " +
        (accent ? "border-accent/40 bg-accent/5" : "border-border bg-surface")
      }
    >
      <div className="text-xs uppercase tracking-wide text-fg-subtle">
        {label}
      </div>
      <div
        className={
          "mt-2 text-xl font-bold " + (accent ? "text-accent" : "text-fg")
        }
      >
        {value}
      </div>
    </div>
  );
}
