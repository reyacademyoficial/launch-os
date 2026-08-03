"use client";

import { useMemo, useState } from "react";

import { fmtNumber, fmtPercent } from "@/lib/format";
import { fmtNative, fmtUsd } from "@/lib/money";
import type { LeaderboardRow } from "@/lib/leaderboard/aggregate";
import type { TeamMemberPayoutRow } from "@/lib/payouts/types";

/**
 * Comisiones acumuladas por moneda (0107). Muestra ambas cuando conviven,
 * una sola cuando el miembro sólo tiene una. El usuario pidió no convertir
 * — cada tier `fixed` respeta su moneda tal como se cargó.
 */
function fmtCommissionsDual(ars: number, usd: number): string {
  if (ars > 0 && usd > 0) {
    return `${fmtNative(ars, "ARS")} · ${fmtNative(usd, "USD")}`;
  }
  if (usd > 0) return fmtNative(usd, "USD");
  return fmtNative(ars, "ARS");
}

import type { PayoutActionState } from "./actions";
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
 * Tabla ordenable por columna con estilo KG. Sort client-side sobre el
 * array del server — dataset chico (decenas de miembros por proyecto).
 *
 * Regla design system: la plata NO se pinta. Únicos usos de color:
 *   - "commissionAccrued" con acento (es el KPI destacado).
 *   - "pending": warning si > 0 (le debemos al equipo), success si = 0.
 *     Ambos son SEMÁNTICOS (estado de deuda), no decorativos.
 * Los signos negativos comunican dirección.
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
    const named = rows.filter((r) => r.teamMember !== null);
    const unassigned = rows.filter((r) => r.teamMember === null);
    named.sort((a, b) => {
      const va = readValue(a, sortKey);
      const vb = readValue(b, sortKey);
      if (typeof va === "string" && typeof vb === "string") {
        return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      const na = Number(va);
      const nb = Number(vb);
      return sortDir === "asc" ? na - nb : nb - na;
    });
    return [...named, ...unassigned];
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
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          minWidth: 960,
          borderCollapse: "collapse",
          fontSize: 12.5,
        }}
      >
        <thead>
          <tr>
            <th
              scope="col"
              style={{
                ...thStyle,
                textAlign: "left",
                width: 40,
              }}
            >
              #
            </th>
            {COLUMNS.map((c) => {
              const active = sortKey === c.key;
              const arrow = active ? (sortDir === "asc" ? " ↑" : " ↓") : "";
              return (
                <th
                  key={c.key}
                  scope="col"
                  style={{
                    ...thStyle,
                    textAlign: c.align === "right" ? "right" : "left",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => clickHeader(c.key)}
                    className="kg-focus"
                    style={{
                      background: "transparent",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      color: active ? "var(--kg-text-1)" : "var(--kg-text-3)",
                      font: "inherit",
                      letterSpacing: "inherit",
                      textTransform: "inherit",
                    }}
                  >
                    {c.label}
                    {arrow}
                  </button>
                </th>
              );
            })}
            <th
              scope="col"
              style={{ ...thStyle, textAlign: "right", width: 100 }}
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, idx) => {
            const isUnassigned = row.teamMember === null;
            return (
              <tr
                key={row.teamMember?.id ?? "__unassigned__"}
                className="kg-row"
                style={{
                  borderTop: "1px solid var(--kg-border-subtle)",
                  background: isUnassigned
                    ? "var(--kg-surface-2-solid)"
                    : "transparent",
                }}
              >
                <td
                  className="kg-num"
                  style={{
                    ...tdStyle,
                    color: "var(--kg-text-3)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {isUnassigned ? "—" : idx + 1}
                </td>
                <td style={tdStyle}>
                  {row.teamMember ? (
                    <>
                      <div
                        style={{
                          fontWeight: 600,
                          color: "var(--kg-text-1)",
                        }}
                      >
                        {row.teamMember.name}
                      </div>
                      <div
                        className="kg-t7"
                        style={{ color: "var(--kg-text-3)" }}
                      >
                        {labelForRole(row.teamMember.role)}
                        {!row.teamMember.active && " · inactivo"}
                      </div>
                    </>
                  ) : (
                    <>
                      <div
                        style={{
                          fontWeight: 600,
                          fontStyle: "italic",
                          color: "var(--kg-text-2)",
                        }}
                      >
                        Sin asignar
                      </div>
                      <div
                        className="kg-t7"
                        style={{ color: "var(--kg-text-3)" }}
                      >
                        Leads y ventas sin setter
                      </div>
                    </>
                  )}
                </td>
                <NumericTD>{fmtNumber(row.leadsWorked)}</NumericTD>
                <NumericTD strong>{fmtNumber(row.closed)}</NumericTD>
                <NumericTD>{fmtPercent(row.conversionRate)}</NumericTD>
                <NumericTD strong>{fmtUsd(row.revenueCollected)}</NumericTD>
                <NumericTD accent bold>
                  {fmtCommissionsDual(
                    row.commissionAccruedArs,
                    row.commissionAccruedUsd,
                  )}
                </NumericTD>
                <NumericTD muted>
                  {isUnassigned ? "—" : fmtUsd(row.paidOut)}
                </NumericTD>
                <NumericTD
                  bold
                  tone={
                    isUnassigned
                      ? "muted"
                      : row.pending > 0
                        ? "warning"
                        : row.pending < 0
                          ? "negative"
                          : "positive"
                  }
                >
                  {isUnassigned ? "—" : fmtUsd(row.pending)}
                </NumericTD>
                <td style={{ ...tdStyle, textAlign: "right" }}>
                  {row.teamMember ? (
                    <PayoutsModal
                      row={row}
                      payouts={payoutsByMember[row.teamMember.id] ?? []}
                      launches={launches}
                      activeLaunchId={activeLaunchId}
                      canEdit={canEdit}
                      createPayoutAction={createPayoutAction}
                      deletePayoutAction={deletePayoutAction}
                    />
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Sub-componentes ─────────────────────────────────────────────────────

function NumericTD({
  children,
  muted,
  strong,
  bold,
  accent,
  tone,
}: {
  readonly children: React.ReactNode;
  readonly muted?: boolean;
  readonly strong?: boolean;
  readonly bold?: boolean;
  readonly accent?: boolean;
  readonly tone?: "warning" | "negative" | "positive" | "muted";
}) {
  const toneColor: React.CSSProperties["color"] =
    tone === "warning"
      ? "#FFB800"
      : tone === "negative"
        ? "#EF4444"
        : tone === "positive"
          ? "#00D084"
          : tone === "muted"
            ? "var(--kg-text-3)"
            : undefined;

  const baseColor = accent
    ? "var(--kg-accent-text)"
    : strong
      ? "var(--kg-text-1)"
      : muted
        ? "var(--kg-text-3)"
        : "var(--kg-text-2)";

  return (
    <td
      className="kg-num"
      style={{
        ...tdStyle,
        textAlign: "right",
        color: toneColor ?? baseColor,
        fontVariantNumeric: "tabular-nums",
        fontWeight: bold ? 700 : undefined,
      }}
    >
      {children}
    </td>
  );
}

function readValue(row: LeaderboardRow, key: SortKey): number | string {
  if (key === "name") return row.teamMember?.name.toLowerCase() ?? "";
  // Sort de "Comisión": suma ambas monedas como proxy — imperfecto cuando
  // convive ARS+USD (mezcla unidades) pero razonable para ordenar el top.
  // Mientras la operación siga siendo ARS mayoritaria no se nota.
  if (key === "commissionAccrued") {
    return row.commissionAccruedArs + row.commissionAccruedUsd;
  }
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

const thStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderBottom: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-3)",
  fontWeight: 600,
  fontSize: 11,
  letterSpacing: 0.2,
  textTransform: "uppercase",
  whiteSpace: "nowrap",
  background: "transparent",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 14px",
  color: "var(--kg-text-1)",
  whiteSpace: "nowrap",
};
