"use client";

import { useState, useTransition } from "react";

import { Drawer } from "@/components/kg/drawer";
import { EmptyState } from "@/components/kg/empty-state";
import { fmtDate, fmtMoney } from "@/lib/format";
import type { LeaderboardRow } from "@/lib/leaderboard/aggregate";
import type { TeamMemberPayoutRow } from "@/lib/payouts/types";

import type { PayoutActionState } from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer por miembro: balance del filtro actual + historial + registrar pago.
//
// Nombre `PayoutsModal` conservado por compatibilidad de import, pero es un
// Drawer KG en la implementación. Preserva la decisión de UX: el listado
// respeta el filtro de launch activo con toggle para ver todo el historial.
// ═══════════════════════════════════════════════════════════════════════════

type CreateAction = (
  prev: PayoutActionState,
  formData: FormData,
) => Promise<PayoutActionState>;
type DeleteAction = (payoutId: string) => Promise<void>;

export function PayoutsModal({
  row,
  payouts,
  launches,
  activeLaunchId,
  canEdit,
  createPayoutAction,
  deletePayoutAction,
}: {
  readonly row: LeaderboardRow;
  readonly payouts: ReadonlyArray<TeamMemberPayoutRow>;
  readonly launches: ReadonlyArray<{ id: string; name: string }>;
  readonly activeLaunchId: string;
  readonly canEdit: boolean;
  readonly createPayoutAction: CreateAction;
  readonly deletePayoutAction: DeleteAction;
}) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const launchNameById = new Map(launches.map((l) => [l.id, l.name]));

  // Guard: el caller sólo renderiza este componente si teamMember != null.
  if (!row.teamMember) return null;
  const member = row.teamMember;

  const filtered =
    activeLaunchId && !showAll
      ? payouts.filter((p) => p.launch_id === activeLaunchId)
      : payouts;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="kg-focus"
        style={triggerBtn}
      >
        Pagos
      </button>

      {open && (
        <Drawer
          open={open}
          onClose={() => setOpen(false)}
          title={`Pagos a ${member.name}`}
          subtitle={
            activeLaunchId
              ? "Balance del lanzamiento filtrado"
              : "Balance global del miembro"
          }
          width={640}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <BalanceCards row={row} />

            {canEdit && launches.length > 0 && (
              <PayoutForm
                defaultLaunchId={activeLaunchId}
                launches={launches}
                teamMemberId={member.id}
                createPayoutAction={createPayoutAction}
              />
            )}
            {canEdit && launches.length === 0 && (
              <EmptyState
                title="No hay lanzamientos"
                hint="Creá un lanzamiento antes de registrar pagos."
              />
            )}

            <section
              style={{ display: "flex", flexDirection: "column", gap: 10 }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <h4
                  className="kg-t7"
                  style={{
                    margin: 0,
                    color: "var(--kg-text-3)",
                    fontWeight: 700,
                    letterSpacing: 0.4,
                    textTransform: "uppercase",
                  }}
                >
                  Historial de pagos
                </h4>
                {activeLaunchId && (
                  <button
                    type="button"
                    onClick={() => setShowAll((v) => !v)}
                    className="kg-focus"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--kg-text-3)",
                      fontSize: 11,
                      cursor: "pointer",
                      textDecoration: "underline",
                    }}
                  >
                    {showAll
                      ? "Ver solo este lanzamiento"
                      : "Ver todos los lanzamientos"}
                  </button>
                )}
              </div>
              {filtered.length === 0 ? (
                <div
                  style={{
                    padding: "16px 20px",
                    borderRadius: "var(--kg-r-8)",
                    border: "1px dashed var(--kg-border-subtle)",
                    background: "var(--kg-surface-2-solid)",
                    fontSize: 12.5,
                    color: "var(--kg-text-3)",
                  }}
                >
                  Todavía no se cargó ningún pago para este miembro.
                </div>
              ) : (
                <ul
                  style={{
                    listStyle: "none",
                    margin: 0,
                    padding: 0,
                    borderRadius: "var(--kg-r-8)",
                    border: "1px solid var(--kg-border-subtle)",
                    overflow: "hidden",
                  }}
                >
                  {filtered.map((p, i) => (
                    <PayoutItem
                      key={p.id}
                      payout={p}
                      launchName={launchNameById.get(p.launch_id) ?? "—"}
                      canEdit={canEdit}
                      deletePayoutAction={deletePayoutAction}
                      first={i === 0}
                    />
                  ))}
                </ul>
              )}
            </section>
          </div>
        </Drawer>
      )}
    </>
  );
}

function BalanceCards({ row }: { readonly row: LeaderboardRow }) {
  const negativeBalance = row.pending < 0;
  return (
    <div
      style={{
        display: "grid",
        gap: 10,
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
      }}
    >
      <BalanceCard label="Comisión" value={fmtMoney(row.commissionAccrued)} />
      <BalanceCard label="Pagado" value={fmtMoney(row.paidOut)} />
      <BalanceCard
        label={negativeBalance ? "A favor del miembro" : "Pendiente"}
        value={fmtMoney(Math.abs(row.pending))}
        tone={row.pending > 0 ? "warning" : "success"}
      />
    </div>
  );
}

function BalanceCard({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: "warning" | "success";
}) {
  const spec: { border: string; color: string; bg: string } =
    tone === "warning"
      ? { border: "#FFB800", color: "#FFB800", bg: "rgba(255,184,0,0.08)" }
      : tone === "success"
        ? { border: "#00D084", color: "#00D084", bg: "rgba(0,208,132,0.08)" }
        : {
            border: "var(--kg-border-subtle)",
            color: "var(--kg-text-1)",
            bg: "var(--kg-surface-2-solid)",
          };
  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: "var(--kg-r-8)",
        border: `1px solid ${spec.border}`,
        background: spec.bg,
      }}
    >
      <div
        className="kg-t7"
        style={{ color: "var(--kg-text-3)" }}
      >
        {label}
      </div>
      <div
        className="kg-num"
        style={{
          marginTop: 6,
          fontSize: 18,
          fontWeight: 700,
          color: spec.color,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function PayoutForm({
  defaultLaunchId,
  launches,
  teamMemberId,
  createPayoutAction,
}: {
  readonly defaultLaunchId: string;
  readonly launches: ReadonlyArray<{ id: string; name: string }>;
  readonly teamMemberId: string;
  readonly createPayoutAction: CreateAction;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [key, setKey] = useState(0); // re-mount → reset

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createPayoutAction(null, formData);
      if (result && "error" in result) {
        setError(result.error);
        return;
      }
      setKey((k) => k + 1);
    });
  }

  return (
    <form
      key={key}
      action={handleSubmit}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 14,
        borderRadius: "var(--kg-r-8)",
        border: "1px solid var(--kg-border-subtle)",
        background: "var(--kg-surface-2-solid)",
      }}
    >
      <h4
        className="kg-t7"
        style={{
          margin: 0,
          color: "var(--kg-text-3)",
          fontWeight: 700,
          letterSpacing: 0.4,
          textTransform: "uppercase",
        }}
      >
        Registrar pago
      </h4>
      <input type="hidden" name="team_member_id" value={teamMemberId} />

      <Field label="Lanzamiento" htmlFor="payout-launch" required>
        <select
          id="payout-launch"
          name="launch_id"
          required
          defaultValue={defaultLaunchId}
          style={inputStyle}
        >
          <option value="" disabled>
            Elegí un lanzamiento
          </option>
          {launches.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </Field>

      <div
        style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}
      >
        <Field label="Monto" htmlFor="payout-amount" required>
          <input
            id="payout-amount"
            name="amount"
            type="number"
            step="0.01"
            min="0.01"
            required
            placeholder="100"
            style={inputStyle}
          />
        </Field>
        <Field label="Fecha" htmlFor="payout-date">
          <input
            id="payout-date"
            name="paid_at"
            type="date"
            defaultValue={new Date().toISOString().slice(0, 10)}
            style={inputStyle}
          />
        </Field>
      </div>

      <Field label="Notas" htmlFor="payout-notes">
        <input
          id="payout-notes"
          name="notes"
          type="text"
          placeholder="Opcional"
          style={inputStyle}
        />
      </Field>

      {error && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: "var(--kg-r-8)",
            background: "rgba(239,68,68,0.10)",
            border: "1px solid #EF4444",
            color: "#EF4444",
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      <div>
        <button
          type="submit"
          disabled={pending}
          className="kg-focus"
          style={{ ...primaryBtn, opacity: pending ? 0.7 : 1 }}
        >
          {pending ? "Registrando…" : "+ Registrar pago"}
        </button>
      </div>
    </form>
  );
}

function PayoutItem({
  payout,
  launchName,
  canEdit,
  deletePayoutAction,
  first,
}: {
  readonly payout: TeamMemberPayoutRow;
  readonly launchName: string;
  readonly canEdit: boolean;
  readonly deletePayoutAction: DeleteAction;
  readonly first: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  return (
    <li
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "10px 14px",
        fontSize: 12.5,
        borderTop: first ? "none" : "1px solid var(--kg-border-subtle)",
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          className="kg-num"
          style={{
            fontWeight: 700,
            color: "var(--kg-text-1)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {fmtMoney(payout.amount)}
        </div>
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginTop: 2 }}
        >
          {fmtDate(payout.paid_at)}
          <span style={{ margin: "0 8px" }}>·</span>
          <span>{launchName}</span>
          {payout.notes && (
            <>
              <span style={{ margin: "0 8px" }}>·</span>
              <span>{payout.notes}</span>
            </>
          )}
        </div>
      </div>
      {canEdit && (
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            if (!confirm(`¿Borrar pago de ${fmtMoney(payout.amount)}?`)) return;
            startTransition(async () => {
              await deletePayoutAction(payout.id);
            });
          }}
          className="kg-focus"
          style={{
            padding: "3px 10px",
            borderRadius: 999,
            background: "transparent",
            border: "1px solid var(--kg-border-subtle)",
            color: "#EF4444",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            opacity: isPending ? 0.5 : 1,
          }}
          aria-label="Borrar pago"
        >
          ×
        </button>
      )}
    </li>
  );
}

// ─── Sub-componentes de layout ────────────────────────────────────────────

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  readonly label: string;
  readonly htmlFor: string;
  readonly required?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="kg-t7"
        style={{ display: "block", color: "var(--kg-text-3)", marginBottom: 6 }}
      >
        {label}
        {required && (
          <span aria-hidden="true" style={{ color: "#EF4444", marginLeft: 4 }}>
            *
          </span>
        )}
      </label>
      {children}
    </div>
  );
}

const triggerBtn: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  borderRadius: "var(--kg-r-8)",
  background: "var(--kg-surface-1-solid)",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-1)",
  fontSize: 12.5,
};

const primaryBtn: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 999,
  background: "var(--kg-accent-500)",
  border: "none",
  color: "#fff",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};
