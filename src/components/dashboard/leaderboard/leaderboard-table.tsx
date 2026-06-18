"use client";

import { useMemo, useState } from "react";

import type { PayoutActionState } from "@/app/(app)/proyectos/[projectId]/leaderboard/actions";
import { fmtMoney, fmtNumber, fmtPercent } from "@/lib/format";
import type { LeaderboardRow } from "@/lib/leaderboard/aggregate";
import type { TeamMemberPayoutRow } from "@/lib/payouts/types";

import { PayoutsModal } from "./payouts-modal";

type SortKey =
  | "name"
  | "leadsWorked"
  | "closed"
  | "conversionRate"
  | "revenueCollected"
  | "commissionAccrued"
  | "paidOut"
  | "pending";

type SortDir = "asc" | "desc";

type CreateAction = (
  prev: PayoutActionState,
  formData: FormData,
) => Promise<PayoutActionState>;
type DeleteAction = (payoutId: string) => Promise<void>;

const COLUMNS: ReadonlyArray<{
  key: SortKey;
  label: string;
  align: "left" | "right";
  defaultDir: SortDir;
}> = [
  { key: "name", label: "Team member", align: "left", defaultDir: "asc" },
  { key: "leadsWorked", label: "Leads", align: "right", defaultDir: "desc" },
  { key: "closed", label: "Cerrados", align: "right", defaultDir: "desc" },
  { key: "conversionRate", label: "Conversión", align: "right", defaultDir: "desc" },
  { key: "revenueCollected", label: "Cobrado", align: "right", defaultDir: "desc" },
  { key: "commissionAccrued", label: "Comisión", align: "right", defaultDir: "desc" },
  { key: "paidOut", label: "Pagado", align: "right", defaultDir: "desc" },
  { key: "pending", label: "Pendiente", align: "right", defaultDir: "desc" },
];

/**
 * Tabla ordenable por columna. Sort client-side sobre el array que vino del
 * server — el dataset es chico (un proyecto típico = decenas de miembros),
 * no necesita paginar ni virtualizar.
 *
 * Sin filtros de DB acá: filtros aplicaron arriba en el server component (vía
 * `aggregateLeaderboard`).
 */
export function LeaderboardTable({
  rows,
  payoutsByMember,
  launches,
  activeLaunchId,
  canEdit,
  createPayoutAction,
  deletePayoutAction,
}: {
  readonly rows: ReadonlyArray<LeaderboardRow>;
  /** Historial completo de pagos por miembro (el modal filtra in-memory). */
  readonly payoutsByMember: Readonly<Record<string, TeamMemberPayoutRow[]>>;
  readonly launches: ReadonlyArray<{ id: string; name: string }>;
  readonly activeLaunchId: string;
  readonly canEdit: boolean;
  readonly createPayoutAction: CreateAction;
  readonly deletePayoutAction: DeleteAction;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("commissionAccrued");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const va = readValue(a, sortKey);
      const vb = readValue(b, sortKey);
      if (typeof va === "string" && typeof vb === "string") {
        return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      const na = Number(va);
      const nb = Number(vb);
      return sortDir === "asc" ? na - nb : nb - na;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  function clickHeader(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(COLUMNS.find((c) => c.key === key)?.defaultDir ?? "desc");
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[960px] text-sm">
        <thead className="bg-surface text-xs uppercase tracking-wide text-fg-subtle">
          <tr>
            <th scope="col" className="px-4 py-3 text-left font-medium">
              #
            </th>
            {COLUMNS.map((c) => {
              const active = sortKey === c.key;
              const arrow = active ? (sortDir === "asc" ? " ↑" : " ↓") : "";
              return (
                <th
                  key={c.key}
                  scope="col"
                  className={
                    "px-4 py-3 font-medium " +
                    (c.align === "right" ? "text-right" : "text-left")
                  }
                >
                  <button
                    type="button"
                    onClick={() => clickHeader(c.key)}
                    className={
                      "hover:text-fg " + (active ? "text-fg" : "")
                    }
                  >
                    {c.label}
                    {arrow}
                  </button>
                </th>
              );
            })}
            <th scope="col" className="px-4 py-3 text-right font-medium">
              {/* Acciones — sin sort */}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, idx) => (
            <tr
              key={row.teamMember.id}
              className="border-t border-border transition-colors hover:bg-surface"
            >
              <td className="px-4 py-3 tabular-nums text-fg-subtle">
                {idx + 1}
              </td>
              <td className="px-4 py-3">
                <div className="font-medium text-fg">{row.teamMember.name}</div>
                <div className="text-xs text-fg-subtle">
                  {labelForRole(row.teamMember.role)}
                  {!row.teamMember.active && " · inactivo"}
                </div>
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-fg-muted">
                {fmtNumber(row.leadsWorked)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-fg">
                {fmtNumber(row.closed)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-fg-muted">
                {fmtPercent(row.conversionRate)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-fg">
                {fmtMoney(row.revenueCollected)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums font-bold text-accent">
                {fmtMoney(row.commissionAccrued)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-fg-muted">
                {fmtMoney(row.paidOut)}
              </td>
              <td
                className={
                  "px-4 py-3 text-right tabular-nums font-medium " +
                  (row.pending > 0
                    ? "text-warning"
                    : row.pending < 0
                      ? "text-error"
                      : "text-success")
                }
              >
                {fmtMoney(row.pending)}
              </td>
              <td className="px-4 py-3 text-right">
                <PayoutsModal
                  row={row}
                  payouts={payoutsByMember[row.teamMember.id] ?? []}
                  launches={launches}
                  activeLaunchId={activeLaunchId}
                  canEdit={canEdit}
                  createPayoutAction={createPayoutAction}
                  deletePayoutAction={deletePayoutAction}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function readValue(row: LeaderboardRow, key: SortKey): number | string {
  if (key === "name") return row.teamMember.name.toLowerCase();
  return row[key];
}

function labelForRole(role: string): string {
  switch (role) {
    case "setter":
      return "Setter";
    case "closer":
      return "Closer";
    case "media_buyer":
      return "Media buyer";
    case "manager":
      return "Manager";
    default:
      return "Otro";
  }
}
