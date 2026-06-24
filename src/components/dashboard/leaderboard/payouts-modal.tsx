"use client";

import { useState, useTransition } from "react";

import type { PayoutActionState } from "@/app/(app)/proyectos/[projectId]/leaderboard/actions";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { fmtDate, fmtMoney } from "@/lib/format";
import type { LeaderboardRow } from "@/lib/leaderboard/aggregate";
import type { TeamMemberPayoutRow } from "@/lib/payouts/types";

type CreateAction = (
  prev: PayoutActionState,
  formData: FormData,
) => Promise<PayoutActionState>;
type DeleteAction = (payoutId: string) => Promise<void>;

/**
 * Modal por miembro: muestra el balance (comisión / pagado / pendiente) en el
 * filtro actual, lista el historial de pagos y permite registrar uno nuevo.
 *
 * Decisión: el listado por default respeta el filtro de launch activo en la
 * URL (lo que ve la fila de la tabla). Si el usuario quiere ver todo el
 * historial del miembro, hay un toggle "Ver todos los lanzamientos".
 */
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
  /** Todo el historial del miembro — el modal lo filtra in-memory. */
  readonly payouts: ReadonlyArray<TeamMemberPayoutRow>;
  readonly launches: ReadonlyArray<{ id: string; name: string }>;
  /** Launch activo en la URL (si el leaderboard está filtrado). */
  readonly activeLaunchId: string;
  readonly canEdit: boolean;
  readonly createPayoutAction: CreateAction;
  readonly deletePayoutAction: DeleteAction;
}) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const launchNameById = new Map(launches.map((l) => [l.id, l.name]));

  // El caller (LeaderboardTable) sólo renderiza este modal cuando la fila
  // pertenece a un miembro nombrado — la fila "Sin asignar" no tiene botón
  // Pagos. Estrechamos el tipo acá para no esparcir `!` por el JSX.
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
        className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg hover:bg-bg-elevated"
      >
        Pagos
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 sm:p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-md border border-border bg-bg-elevated shadow-card">
            <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
              <div>
                <h3 className="text-lg font-bold text-fg">
                  Pagos a {member.name}
                </h3>
                <p className="mt-0.5 text-xs text-fg-subtle">
                  {activeLaunchId
                    ? "Balance del lanzamiento filtrado"
                    : "Balance global del miembro"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                className="text-fg-subtle hover:text-fg"
              >
                ×
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-6 py-6">
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
                <div className="mt-6 rounded-md border border-dashed border-border bg-surface/40 p-4 text-sm text-fg-muted">
                  No hay lanzamientos creados todavía. Creá uno antes de
                  registrar pagos.
                </div>
              )}

              <section className="mt-6 space-y-2">
                <div className="flex items-baseline justify-between gap-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                    Historial de pagos
                  </h4>
                  {activeLaunchId && (
                    <button
                      type="button"
                      onClick={() => setShowAll((v) => !v)}
                      className="text-xs text-fg-muted underline-offset-2 hover:text-fg hover:underline"
                    >
                      {showAll
                        ? "Ver solo este lanzamiento"
                        : "Ver todos los lanzamientos"}
                    </button>
                  )}
                </div>
                {filtered.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border bg-surface/40 p-4 text-sm text-fg-muted">
                    Todavía no se cargó ningún pago para este miembro.
                  </p>
                ) : (
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {filtered.map((p) => (
                      <PayoutItem
                        key={p.id}
                        payout={p}
                        launchName={launchNameById.get(p.launch_id) ?? "—"}
                        canEdit={canEdit}
                        deletePayoutAction={deletePayoutAction}
                      />
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function BalanceCards({ row }: { readonly row: LeaderboardRow }) {
  const negativeBalance = row.pending < 0;
  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Card label="Comisión" value={fmtMoney(row.commissionAccrued)} />
      <Card label="Pagado" value={fmtMoney(row.paidOut)} />
      <Card
        label={negativeBalance ? "A favor del miembro" : "Pendiente"}
        value={fmtMoney(Math.abs(row.pending))}
        tone={row.pending > 0 ? "warning" : "success"}
      />
    </section>
  );
}

function Card({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: "warning" | "success";
}) {
  const toneClass =
    tone === "warning"
      ? "border-warning/40 bg-warning/5 text-warning"
      : tone === "success"
        ? "border-success/40 bg-success/5 text-success"
        : "border-border bg-surface/40 text-fg";
  return (
    <div className={`rounded-md border p-3 ${toneClass}`}>
      <div className="text-xs uppercase tracking-wide text-fg-subtle">
        {label}
      </div>
      <div className="mt-1 text-lg font-bold tabular-nums">{value}</div>
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
      className="mt-6 space-y-3 rounded-md border border-border bg-surface/40 p-4"
    >
      <h4 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
        Registrar pago
      </h4>
      <input type="hidden" name="team_member_id" value={teamMemberId} />

      <div>
        <Label htmlFor="payout-launch">Lanzamiento *</Label>
        <Select
          id="payout-launch"
          name="launch_id"
          required
          defaultValue={defaultLaunchId}
        >
          <option value="" disabled>
            Elegí un lanzamiento
          </option>
          {launches.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="payout-amount">Monto *</Label>
          <Input
            id="payout-amount"
            name="amount"
            type="number"
            step="0.01"
            min="0.01"
            required
            placeholder="100"
          />
        </div>
        <div>
          <Label htmlFor="payout-date">Fecha</Label>
          <Input
            id="payout-date"
            name="paid_at"
            type="date"
            defaultValue={new Date().toISOString().slice(0, 10)}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="payout-notes">Notas</Label>
        <Input id="payout-notes" name="notes" placeholder="Opcional" />
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Registrando…" : "+ Registrar pago"}
        </Button>
        {error && <FieldError>{error}</FieldError>}
      </div>
    </form>
  );
}

function PayoutItem({
  payout,
  launchName,
  canEdit,
  deletePayoutAction,
}: {
  readonly payout: TeamMemberPayoutRow;
  readonly launchName: string;
  readonly canEdit: boolean;
  readonly deletePayoutAction: DeleteAction;
}) {
  const [isPending, startTransition] = useTransition();
  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <div className="font-medium tabular-nums text-fg">
          {fmtMoney(payout.amount)}
        </div>
        <div className="mt-0.5 text-xs text-fg-subtle">
          {fmtDate(payout.paid_at)}
          <span className="mx-2">·</span>
          <span className="text-fg-muted">{launchName}</span>
          {payout.notes && (
            <>
              <span className="mx-2">·</span>
              <span className="text-fg-muted">{payout.notes}</span>
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
          className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-error hover:bg-error/10 disabled:opacity-50"
        >
          ×
        </button>
      )}
    </li>
  );
}
