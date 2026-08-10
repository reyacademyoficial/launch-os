"use client";

import { useMemo, useState, useTransition } from "react";

import { Drawer } from "@/components/kg/drawer";
import { EmptyState } from "@/components/kg/empty-state";
import { fCount, fMoney } from "@/lib/finance/format";
import {
  scoreExpenseMatches,
  type MovementCandidate,
} from "@/lib/finance/expense-matching";

import {
  linkExpenseToMovement,
  unlinkExpenseFromMovement,
  type ExpenseMovementRole,
  type LinkPaymentResult,
} from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer para vincular un gasto a un movimiento bancario existente.
//
// Feedback 6c-write.A: ordena, NO filtra. Los `unconciledMovements` vienen
// del server con TODOS los movimientos no conciliados; el scorer los ordena
// y el buscador de esta vista permite acceder al resto por texto o monto.
//
// Warning explícito cuando la moneda no coincide o la diferencia de monto es
// significativa — pero NO se bloquea la vinculación. El humano decide.
// ═══════════════════════════════════════════════════════════════════════════

export interface ExpenseLinkedMovement {
  readonly movementId: string;
  readonly role: ExpenseMovementRole;
  readonly amount: number;
  readonly kind: "in" | "out";
  readonly occurredAt: string;
  readonly description: string | null;
  readonly bankName: string;
}

export interface ExpenseForLinking {
  readonly id: string;
  readonly description: string;
  readonly amountGross: number;
  readonly currency: string;
  readonly expenseDate: string;
  readonly paidAt: string | null;
  readonly bankMovementId: string | null;
  /** Movimientos ya linkeados vía bridge (paso 6). */
  readonly linkedMovements?: readonly ExpenseLinkedMovement[];
}

export interface UnconciledMovement extends MovementCandidate {
  readonly bankName: string;
  readonly projectName: string;
  readonly description: string;
}

export interface LinkPaymentDrawerProps {
  readonly expense: ExpenseForLinking;
  readonly unconciledMovements: readonly UnconciledMovement[];
  readonly onClose: () => void;
}

export function LinkPaymentDrawer({
  expense,
  unconciledMovements,
  onClose,
}: LinkPaymentDrawerProps) {
  const linked = expense.linkedMovements ?? [];
  const hasLinked = linked.length > 0;
  return (
    <Drawer
      open
      onClose={onClose}
      title={hasLinked ? "Vincular más movimientos" : "Vincular movimientos"}
      subtitle={expense.description}
      width={720}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {hasLinked && (
          <LinkedMovementsList
            expense={expense}
            movements={linked}
            onClose={onClose}
          />
        )}
        <PickMovement
          expense={expense}
          unconciledMovements={unconciledMovements}
          onClose={onClose}
          allowClose={!hasLinked}
        />
      </div>
    </Drawer>
  );
}

// ─── Caso: ya vinculado → solo mostramos y ofrecemos desvincular ──────────

function LinkedMovementsList({
  expense,
  movements,
  onClose,
}: {
  readonly expense: ExpenseForLinking;
  readonly movements: readonly ExpenseLinkedMovement[];
  readonly onClose: () => void;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleUnlink(movementId: string) {
    setError(null);
    setPendingId(movementId);
    startTransition(async () => {
      const res = await unlinkExpenseFromMovement(expense.id, movementId);
      setPendingId(null);
      if ("error" in res) setError(res.error);
    });
  }

  const principalSum = movements
    .filter((m) => m.role === "principal")
    .reduce((acc, m) => acc + m.amount, 0);
  const commissionSum = movements
    .filter((m) => m.role === "comision")
    .reduce((acc, m) => acc + m.amount, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="kg-t7" style={{ color: "var(--kg-text-2)", fontWeight: 700 }}>
        Movimientos vinculados ({movements.length})
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {movements.map((m) => (
          <div
            key={m.movementId}
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr auto auto",
              gap: 10,
              alignItems: "center",
              padding: "8px 10px",
              borderRadius: "var(--kg-r-8)",
              background: "var(--kg-surface-2-solid)",
              border: "1px solid var(--kg-border-subtle)",
              fontSize: 12,
            }}
          >
            <RolePill role={m.role} />
            <span style={{ color: "var(--kg-text-2)" }}>
              {m.bankName} · {fmtDate(m.occurredAt)}
              {m.description && (
                <span style={{ color: "var(--kg-text-3)" }}>
                  {" · "}
                  {m.description}
                </span>
              )}
            </span>
            <span
              style={{
                color: m.kind === "in" ? "#00D084" : "#EF4444",
                fontWeight: 700,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {m.kind === "in" ? "+" : "−"}
              {fMoney(m.amount)}
            </span>
            <button
              type="button"
              onClick={() => handleUnlink(m.movementId)}
              disabled={isPending && pendingId === m.movementId}
              className="kg-focus"
              style={{
                ...secondaryBtn,
                color: "#EF4444",
                borderColor: "#EF4444",
                padding: "3px 10px",
                fontSize: 10,
                opacity: isPending && pendingId === m.movementId ? 0.6 : 1,
              }}
              title="Desvincular"
            >
              {isPending && pendingId === m.movementId ? "…" : "Desvincular"}
            </button>
          </div>
        ))}
      </div>
      <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
        Principal: <b style={{ color: "var(--kg-text-1)" }}>{fMoney(principalSum)}</b>
        {commissionSum > 0 && (
          <>
            {" · "}Comisión:{" "}
            <b style={{ color: "var(--kg-text-1)" }}>{fMoney(commissionSum)}</b>
          </>
        )}
        {" · "}Gasto bruto:{" "}
        <b style={{ color: "var(--kg-text-1)" }}>{fMoney(expense.amountGross)}</b>
      </div>
      {error && <Callout tone="negative">{error}</Callout>}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={onClose}
          disabled={isPending}
          className="kg-focus"
          style={secondaryBtn}
        >
          Cerrar
        </button>
      </div>
    </div>
  );
}

function RolePill({ role }: { readonly role: ExpenseMovementRole }) {
  const spec =
    role === "principal"
      ? { bg: "rgba(0,208,132,0.15)", fg: "#00D084" }
      : role === "comision"
        ? { bg: "rgba(255,184,0,0.15)", fg: "#FFB800" }
        : { bg: "rgba(138,138,153,0.15)", fg: "var(--kg-text-2)" };
  return (
    <span
      style={{
        padding: "1px 8px",
        borderRadius: 999,
        background: spec.bg,
        color: spec.fg,
        fontSize: 10,
        fontWeight: 700,
      }}
    >
      {role}
    </span>
  );
}

// ─── Caso: sin vincular → seleccionar movimiento ──────────────────────────

function PickMovement({
  expense,
  unconciledMovements,
  onClose,
  allowClose,
}: {
  readonly expense: ExpenseForLinking;
  readonly unconciledMovements: readonly UnconciledMovement[];
  readonly onClose: () => void;
  /** True cuando NO hay linkeados aún — el Cancelar cierra el drawer entero. */
  readonly allowClose: boolean;
}) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] =
    useState<ExpenseMovementRole>("principal");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<LinkPaymentResult | null>(null);

  // Score ORDENA, no filtra. Feedback 6c-write.A.
  const scored = useMemo(
    () =>
      scoreExpenseMatches(
        {
          expenseAmountGross: expense.amountGross,
          expenseDateYmd: expense.expenseDate,
          expenseCurrency: expense.currency,
        },
        unconciledMovements,
      ),
    [expense, unconciledMovements],
  );

  // Buscador aplicado sobre el listado ORDENADO. Filtra por descripción o
  // monto (parcial). Es el mecanismo para cuando la coincidencia por scoring
  // no alcanza — ej. el humano se acuerda de la descripción exacta.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return scored;
    return scored.filter((s) => {
      const desc = s.movement.description.toLowerCase();
      const bank = s.movement.bankName.toLowerCase();
      const project = s.movement.projectName.toLowerCase();
      const amount = String(s.movement.amount);
      return (
        desc.includes(q) ||
        bank.includes(q) ||
        project.includes(q) ||
        amount.includes(q)
      );
    });
  }, [scored, query]);

  const selected = filtered.find((s) => s.movement.id === selectedId) ?? null;
  const currencyMismatch = selected?.currencyMatches === false;
  const bigAmountDiff = selected != null && selected.amountDiffPct > 0.05;

  function handleLink() {
    if (!selected) return;
    setResult(null);
    startTransition(async () => {
      const r = await linkExpenseToMovement(
        expense.id,
        selected.movement.id,
        selectedRole,
      );
      setResult(r);
      if ("ok" in r) {
        // Reset local para permitir vincular otro sin cerrar el drawer.
        setSelectedId(null);
        setQuery("");
      }
    });
  }

  if (unconciledMovements.length === 0) {
    return (
      <EmptyState
        title="No hay movimientos sin conciliar"
        hint="Cuando cargues movimientos bancarios sin vincular a otro gasto, aparecen acá para seleccionar."
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Info del gasto para referencia */}
      <div
        style={{
          padding: "10px 14px",
          borderRadius: "var(--kg-r-8)",
          background: "var(--kg-surface-2-solid)",
          border: "1px solid var(--kg-border-subtle)",
          display: "flex",
          gap: 20,
          flexWrap: "wrap",
        }}
      >
        <Metric label="Monto" value={fMoney(expense.amountGross)} />
        <Metric
          label="Moneda"
          value={expense.currency}
          hint={expense.currency}
        />
        <Metric label="Fecha" value={fmtDate(expense.expenseDate)} />
      </div>

      <div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por descripción, banco, proyecto o monto…"
          className="kg-focus"
          style={{
            width: "100%",
            padding: "9px 12px",
            borderRadius: "var(--kg-r-8)",
            background: "var(--kg-surface-2-solid)",
            border: "1px solid var(--kg-border-subtle)",
            color: "var(--kg-text-1)",
            fontSize: 13,
          }}
        />
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginTop: 6 }}
        >
          Ordenados por probabilidad de coincidencia. Todos los movimientos
          sin conciliar están accesibles — ningún filtro los oculta.
        </div>
      </div>

      <div
        style={{
          border: "1px solid var(--kg-border-subtle)",
          borderRadius: "var(--kg-r-8)",
          maxHeight: 360,
          overflowY: "auto",
        }}
      >
        {filtered.length === 0 ? (
          <div
            style={{
              padding: 20,
              textAlign: "center",
              color: "var(--kg-text-3)",
              fontSize: 12,
            }}
          >
            Ningún movimiento coincide con "{query}". Probá otra palabra o
            limpiá la búsqueda.
          </div>
        ) : (
          filtered.map((s) => (
            <MovementRow
              key={s.movement.id}
              scored={s}
              selected={s.movement.id === selectedId}
              onSelect={() => setSelectedId(s.movement.id)}
            />
          ))
        )}
      </div>

      {selected && (currencyMismatch || bigAmountDiff) && (
        <Callout tone="warning">
          {currencyMismatch && (
            <div>
              La moneda del gasto ({expense.currency}) NO coincide con la del
              movimiento ({selected.movement.currency ?? "—"}). Confirmá que
              sea correcto antes de vincular.
            </div>
          )}
          {bigAmountDiff && (
            <div>
              La diferencia de monto es del{" "}
              {(selected.amountDiffPct * 100).toFixed(1)}%. Puede ser un
              recargo o una comisión — considerá vincularlo como{" "}
              <b>Comisión</b>.
            </div>
          )}
        </Callout>
      )}

      {selected && (
        <div>
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-3)", marginBottom: 6 }}
          >
            Rol del vínculo
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {(["principal", "comision", "otro"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setSelectedRole(r)}
                className="kg-focus"
                style={{
                  padding: "6px 14px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                  background:
                    selectedRole === r
                      ? "var(--kg-accent-500)"
                      : "transparent",
                  color:
                    selectedRole === r ? "#fff" : "var(--kg-text-2)",
                  border: "1px solid var(--kg-border-subtle)",
                }}
                title={
                  r === "principal"
                    ? "La salida principal del gasto (exige movimiento kind=out)"
                    : r === "comision"
                      ? "Fee bancario o de pasarela asociado al gasto"
                      : "Ajuste u otro movimiento vinculado"
                }
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      )}

      {result && "error" in result && (
        <Callout tone="negative">{result.error}</Callout>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="kg-focus"
          style={secondaryBtn}
        >
          {allowClose ? "Cancelar" : "Cerrar"}
        </button>
        <button
          type="button"
          onClick={handleLink}
          disabled={pending || !selected}
          className="kg-focus"
          style={{
            ...primaryBtn,
            opacity: pending || !selected ? 0.6 : 1,
          }}
        >
          {pending ? "Vinculando…" : "Vincular movimiento"}
        </button>
      </div>

      <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
        Mostrando {fCount(filtered.length)} de{" "}
        {fCount(unconciledMovements.length)} movimientos sin conciliar.
      </div>
    </div>
  );
}

// ─── Row de un movimiento en la lista ────────────────────────────────────

function MovementRow({
  scored,
  selected,
  onSelect,
}: {
  readonly scored: ReturnType<typeof scoreExpenseMatches<UnconciledMovement>>[number];
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const m = scored.movement;
  const isIn = m.kind === "in";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className="kg-focus"
      style={{
        width: "100%",
        textAlign: "left",
        padding: "10px 14px",
        background: selected
          ? "rgba(64,120,255,0.10)"
          : "transparent",
        border: "none",
        borderBottom: "1px solid var(--kg-border-subtle)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div
        style={{
          width: 32,
          textAlign: "right",
          fontSize: 11,
          color: "var(--kg-text-3)",
          fontVariantNumeric: "tabular-nums",
        }}
        title="Score de coincidencia"
      >
        {Math.round(scored.score)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12.5,
            color: "var(--kg-text-1)",
            fontWeight: 600,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {m.description || "(sin descripción)"}
        </div>
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginTop: 2 }}
        >
          {fmtDate(m.occurredAt)} · {m.projectName} · {m.bankName}
          {isIn && (
            <>
              {" "}
              ·{" "}
              <span style={{ color: "#EF4444" }}>ENTRADA (no puede pagar)</span>
            </>
          )}
        </div>
      </div>
      <div
        className="kg-num"
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: "var(--kg-text-1)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {fMoney(m.amount)}{" "}
        <span
          style={{
            fontSize: 10,
            fontWeight: 500,
            color: "var(--kg-text-3)",
          }}
        >
          {m.currency ?? ""}
        </span>
      </div>
    </button>
  );
}

// ─── Sub-componentes visuales ────────────────────────────────────────────

function Metric({
  label,
  value,
  hint,
}: {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
        {label}
      </span>
      <strong
        style={{
          fontSize: 13,
          color: "var(--kg-text-1)",
          fontVariantNumeric: "tabular-nums",
        }}
        title={hint}
      >
        {value}
      </strong>
    </div>
  );
}

function Callout({
  tone,
  children,
}: {
  readonly tone: "positive" | "warning" | "negative";
  readonly children: React.ReactNode;
}) {
  const map = {
    positive: { bg: "rgba(0,208,132,0.10)", border: "#00D084", fg: "#00D084" },
    warning: { bg: "rgba(255,184,0,0.10)", border: "#FFB800", fg: "#FFB800" },
    negative: { bg: "rgba(239,68,68,0.10)", border: "#EF4444", fg: "#EF4444" },
  } as const;
  const s = map[tone];
  return (
    <div
      style={{
        padding: "10px 14px",
        borderRadius: "var(--kg-r-8)",
        background: s.bg,
        border: `1px solid ${s.border}`,
        color: s.fg,
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}

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

const secondaryBtn: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};

function fmtDate(iso: string): string {
  const s = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
