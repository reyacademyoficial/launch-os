"use client";

import { useMemo, useState } from "react";

import type {
  BankActionState,
  BankMovementActionState,
} from "@/app/(app)/proyectos/[projectId]/bancos/actions";
import type {
  BankBalance,
  BankMovementRow,
  BankRow,
} from "@/lib/banks/types";
import { fmtDate, fmtMoney } from "@/lib/format";
import type { PaymentMethodRow } from "@/lib/payment-methods/types";

import { BankDelete } from "./bank-delete";
import { BankModal } from "./bank-modal";
import { MovementDelete } from "./movement-delete";
import { MovementModal } from "./movement-modal";

type CreateBankAction = (
  prev: BankActionState,
  formData: FormData,
) => Promise<BankActionState>;
type UpdateBankAction = (
  bankId: string,
  prev: BankActionState,
  formData: FormData,
) => Promise<BankActionState>;
type DeleteBankAction = (
  bankId: string,
) => Promise<{ ok: true } | { error: string }>;
type CreateMovementAction = (
  bankId: string,
  prev: BankMovementActionState,
  formData: FormData,
) => Promise<BankMovementActionState>;
type UpdateMovementAction = (
  movementId: string,
  prev: BankMovementActionState,
  formData: FormData,
) => Promise<BankMovementActionState>;
type DeleteMovementAction = (
  movementId: string,
) => Promise<{ ok: true } | { error: string }>;

const FILTER_ALL = "all";

/**
 * Vista principal de Bancos: dashboard con cards de saldo (arriba), tabla de
 * movimientos con filtro por banco (abajo). Los cobros de ventas NO aparecen
 * en la tabla — se agregan al saldo por el link method → bank pero viven en
 * `payments`, no en `bank_movements`. Se documenta en la card del banco.
 */
export function BanksView({
  banks,
  balances,
  paymentMethods,
  movements,
  canEdit,
  createBankAction,
  updateBankAction,
  deleteBankAction,
  createMovementAction,
  updateMovementAction,
  deleteMovementAction,
}: {
  readonly banks: ReadonlyArray<BankRow>;
  readonly balances: ReadonlyMap<string, BankBalance>;
  readonly paymentMethods: ReadonlyArray<PaymentMethodRow>;
  readonly movements: ReadonlyArray<BankMovementRow>;
  readonly canEdit: boolean;
  readonly createBankAction: CreateBankAction;
  readonly updateBankAction: UpdateBankAction;
  readonly deleteBankAction: DeleteBankAction;
  readonly createMovementAction: CreateMovementAction;
  readonly updateMovementAction: UpdateMovementAction;
  readonly deleteMovementAction: DeleteMovementAction;
}) {
  const [filterBankId, setFilterBankId] = useState<string>(FILTER_ALL);

  const bankById = useMemo(
    () => new Map(banks.map((b) => [b.id, b])),
    [banks],
  );

  const methodsByBank = useMemo(() => {
    const out = new Map<string, PaymentMethodRow[]>();
    for (const m of paymentMethods) {
      if (!m.bank_id) continue;
      const arr = out.get(m.bank_id);
      if (arr) arr.push(m);
      else out.set(m.bank_id, [m]);
    }
    return out;
  }, [paymentMethods]);

  const movementsByBank = useMemo(() => {
    const out = new Map<string, BankMovementRow[]>();
    for (const mv of movements) {
      const arr = out.get(mv.bank_id);
      if (arr) arr.push(mv);
      else out.set(mv.bank_id, [mv]);
    }
    return out;
  }, [movements]);

  const filteredMovements = useMemo(
    () =>
      filterBankId === FILTER_ALL
        ? movements
        : movements.filter((mv) => mv.bank_id === filterBankId),
    [movements, filterBankId],
  );

  const grandTotal = useMemo(() => {
    let total = 0;
    for (const b of banks) {
      total += balances.get(b.id)?.total ?? 0;
    }
    return total;
  }, [banks, balances]);

  return (
    <div className="space-y-10">
      {/* ─── Dashboard de bancos ────────────────────────────────────── */}
      <section className="space-y-3">
        <header className="flex items-baseline justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-fg">Bancos</h2>
            <p className="text-xs text-fg-subtle">
              Saldo = saldo inicial + cobros de ventas que entran por los
              métodos linkeados + movimientos manuales.
            </p>
          </div>
          {canEdit && (
            <BankModal
              triggerLabel="+ Nuevo banco"
              triggerClassName="!px-3 !py-1.5 !text-xs"
              title="Nuevo banco"
              submitLabel="Crear"
              action={createBankAction}
            />
          )}
        </header>

        {banks.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-surface/40 p-4 text-sm text-fg-muted">
            Sin bancos todavía. Cargá el primero para poder asignarle métodos
            de pago y registrar movimientos.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {banks.map((b) => {
                const bal =
                  balances.get(b.id) ?? {
                    bank_id: b.id,
                    opening: Number(b.opening_balance) || 0,
                    fromPayments: 0,
                    movementsIn: 0,
                    movementsOut: 0,
                    total: Number(b.opening_balance) || 0,
                  };
                const methods = methodsByBank.get(b.id) ?? [];
                const movementsCount =
                  movementsByBank.get(b.id)?.length ?? 0;
                return (
                  <BankCard
                    key={b.id}
                    bank={b}
                    balance={bal}
                    methods={methods}
                    movementsCount={movementsCount}
                    canEdit={canEdit}
                    updateBankAction={updateBankAction}
                    deleteBankAction={deleteBankAction}
                    createMovementAction={createMovementAction}
                  />
                );
              })}
            </div>
            <div className="rounded-md border border-accent/40 bg-accent/5 p-3 text-sm">
              <span className="text-fg-muted">Saldo consolidado · </span>
              <span className="tabular-nums font-bold text-accent">
                {fmtMoney(grandTotal)}
              </span>
            </div>
          </>
        )}
      </section>

      {/* ─── Movimientos ─────────────────────────────────────────────── */}
      {banks.length > 0 && (
        <section className="space-y-3">
          <header className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-fg">Movimientos</h2>
              <p className="text-xs text-fg-subtle">
                Entradas y salidas manuales. Los cobros de ventas NO aparecen
                acá — se ven en <b>Cobros</b>.
              </p>
            </div>
            <select
              value={filterBankId}
              onChange={(e) => setFilterBankId(e.target.value)}
              className="rounded-md border border-border bg-bg-elevated px-2 py-1 text-sm text-fg"
              aria-label="Filtrar por banco"
            >
              <option value={FILTER_ALL}>Todos los bancos</option>
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {!b.active ? " (inactivo)" : ""}
                </option>
              ))}
            </select>
          </header>

          {filteredMovements.length === 0 ? (
            <p className="rounded-md border border-dashed border-border bg-surface/40 p-4 text-sm text-fg-muted">
              {movements.length === 0
                ? "Sin movimientos registrados. Cargá el primero desde la card del banco."
                : "Ningún movimiento coincide con el filtro."}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-surface text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <tr>
                    <th className="px-3 py-3 font-medium">Fecha</th>
                    <th className="px-3 py-3 font-medium">Banco</th>
                    <th className="px-3 py-3 font-medium">Tipo</th>
                    <th className="px-3 py-3 text-right font-medium">Monto</th>
                    <th className="px-3 py-3 font-medium">Descripción</th>
                    {canEdit && (
                      <th className="px-3 py-3 text-right font-medium">
                        Acciones
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filteredMovements.map((mv) => {
                    const bank = bankById.get(mv.bank_id);
                    const isIn = mv.kind === "in";
                    const boundUpdate: (
                      prev: BankMovementActionState,
                      fd: FormData,
                    ) => Promise<BankMovementActionState> = (prev, fd) =>
                      updateMovementAction(mv.id, prev, fd);
                    return (
                      <tr
                        key={mv.id}
                        className="border-t border-border hover:bg-surface"
                      >
                        <td className="px-3 py-3 text-fg-muted">
                          {fmtDate(mv.occurred_at)}
                        </td>
                        <td className="px-3 py-3 font-medium text-fg">
                          {bank?.name ?? "—"}
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={
                              "rounded-full px-2 py-0.5 text-xs font-medium " +
                              (isIn
                                ? "bg-success/10 text-success"
                                : "bg-error/10 text-error")
                            }
                          >
                            {isIn ? "Entrada" : "Salida"}
                          </span>
                        </td>
                        <td
                          className={
                            "px-3 py-3 text-right tabular-nums " +
                            (isIn ? "text-success" : "text-error")
                          }
                        >
                          {isIn ? "+" : "−"} {fmtMoney(mv.amount)}
                        </td>
                        <td className="px-3 py-3 text-fg-muted">
                          {mv.description ?? "—"}
                        </td>
                        {canEdit && (
                          <td className="px-3 py-3">
                            <div className="flex items-center justify-end gap-2">
                              <MovementModal
                                triggerLabel="Editar"
                                triggerClassName="rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg hover:bg-bg-elevated"
                                title={`Editar movimiento en ${bank?.name ?? "banco"}`}
                                submitLabel="Guardar"
                                action={boundUpdate}
                                initial={mv}
                              />
                              <MovementDelete
                                amount={Number(mv.amount) || 0}
                                kind={mv.kind}
                                action={() => deleteMovementAction(mv.id)}
                              />
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function BankCard({
  bank,
  balance,
  methods,
  movementsCount,
  canEdit,
  updateBankAction,
  deleteBankAction,
  createMovementAction,
}: {
  readonly bank: BankRow;
  readonly balance: BankBalance;
  readonly methods: ReadonlyArray<PaymentMethodRow>;
  readonly movementsCount: number;
  readonly canEdit: boolean;
  readonly updateBankAction: UpdateBankAction;
  readonly deleteBankAction: DeleteBankAction;
  readonly createMovementAction: CreateMovementAction;
}) {
  const boundUpdate: (
    prev: BankActionState,
    fd: FormData,
  ) => Promise<BankActionState> = (prev, fd) =>
    updateBankAction(bank.id, prev, fd);
  const boundCreateMovement: (
    prev: BankMovementActionState,
    fd: FormData,
  ) => Promise<BankMovementActionState> = (prev, fd) =>
    createMovementAction(bank.id, prev, fd);

  return (
    <div
      className={
        "rounded-md border p-4 " +
        (bank.active ? "border-border bg-surface" : "border-border bg-surface/40 opacity-70")
      }
    >
      <header className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-fg">{bank.name}</h3>
          {!bank.active && (
            <span className="text-xs text-fg-subtle">Inactivo</span>
          )}
        </div>
        {canEdit && (
          <div className="flex items-center gap-1">
            <BankModal
              triggerLabel="Editar"
              triggerVariant="secondary"
              triggerClassName="!px-2 !py-1 !text-xs"
              title={`Editar ${bank.name}`}
              submitLabel="Guardar"
              action={boundUpdate}
              initial={bank}
            />
            <BankDelete
              name={bank.name}
              linkedMethodsCount={methods.length}
              movementsCount={movementsCount}
              action={() => deleteBankAction(bank.id)}
            />
          </div>
        )}
      </header>

      <div className="mt-3">
        <div className="text-xs uppercase tracking-wide text-fg-subtle">
          Saldo
        </div>
        <div
          className={
            "text-2xl font-bold tabular-nums " +
            (balance.total >= 0 ? "text-fg" : "text-error")
          }
        >
          {fmtMoney(balance.total)}
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-fg-muted">
        <dt>Saldo inicial</dt>
        <dd className="text-right tabular-nums text-fg">
          {fmtMoney(balance.opening)}
        </dd>
        <dt>Cobros de ventas</dt>
        <dd className="text-right tabular-nums text-fg">
          {fmtMoney(balance.fromPayments)}
        </dd>
        <dt>Entradas manuales</dt>
        <dd className="text-right tabular-nums text-success">
          + {fmtMoney(balance.movementsIn)}
        </dd>
        <dt>Salidas</dt>
        <dd className="text-right tabular-nums text-error">
          − {fmtMoney(balance.movementsOut)}
        </dd>
      </dl>

      <div className="mt-3 text-xs text-fg-subtle">
        {methods.length === 0 ? (
          <span className="text-warning">
            Sin métodos de pago linkeados — los cobros no se agregan a este
            banco.
          </span>
        ) : (
          <>
            Métodos que depositan acá:{" "}
            <span className="text-fg-muted">
              {methods.map((m) => m.name).join(", ")}
            </span>
          </>
        )}
      </div>

      {canEdit && bank.active && (
        <div className="mt-3">
          <MovementModal
            triggerLabel="+ Movimiento"
            triggerClassName="rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-xs font-medium text-accent hover:bg-accent/20"
            title={`Nuevo movimiento en ${bank.name}`}
            submitLabel="Registrar"
            action={boundCreateMovement}
          />
        </div>
      )}
    </div>
  );
}
