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
  linkPayrollToMovement,
  unlinkPayrollPayment,
  type LinkPayrollResult,
} from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer para vincular una liquidación de nómina a un bank_movement out.
//
// Copia estructural del `LinkPaymentDrawer` de gastos — el scoring de matches
// vive en `@/lib/finance/expense-matching` y es agnóstico de la naturaleza
// del ítem (total + fecha + moneda), así que se reutiliza tal cual.
//
// Diferencias con el de gastos:
//   - "Fecha de referencia" del scoring: usamos `dueDate` si está, si no
//     `periodEnd`. Es cuando "corresponde" pagar el sueldo.
//   - Guard: bank_movement.kind='in' no puede pagar (mismo que gastos).
//   - Warning suave si moneda no matchea o diff monto > 5% — no bloquea.
// ═══════════════════════════════════════════════════════════════════════════

export interface PayrollForLinking {
  readonly id: string;
  readonly personName: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly totalAmount: number;
  readonly currency: string;
  readonly dueDate: string | null;
  readonly paidAt: string | null;
  readonly bankMovementId: string | null;
}

export interface UnconciledMovement extends MovementCandidate {
  readonly bankName: string;
  readonly description: string;
}

export interface LinkPaymentDrawerProps {
  readonly payroll: PayrollForLinking;
  readonly unconciledMovements: readonly UnconciledMovement[];
  readonly onClose: () => void;
}

export function LinkPaymentDrawer({
  payroll,
  unconciledMovements,
  onClose,
}: LinkPaymentDrawerProps) {
  const alreadyLinked =
    payroll.paidAt != null && payroll.bankMovementId != null;
  return (
    <Drawer
      open
      onClose={onClose}
      title={alreadyLinked ? "Pago vinculado" : "Vincular pago"}
      subtitle={`${payroll.personName} · ${fmtDate(payroll.periodStart)}–${fmtDate(payroll.periodEnd)}`}
      width={620}
    >
      {alreadyLinked ? (
        <AlreadyLinked payroll={payroll} onClose={onClose} />
      ) : (
        <PickMovement
          payroll={payroll}
          unconciledMovements={unconciledMovements}
          onClose={onClose}
        />
      )}
    </Drawer>
  );
}

// ─── Caso: ya vinculado → ver + desvincular ────────────────────────────────

function AlreadyLinked({
  payroll,
  onClose,
}: {
  readonly payroll: PayrollForLinking;
  readonly onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleUnlink() {
    setError(null);
    startTransition(async () => {
      const res = await unlinkPayrollPayment(payroll.id);
      if ("ok" in res) onClose();
      else setError(res.error);
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: 13, color: "var(--kg-text-2)", lineHeight: 1.6 }}>
        Esta liquidación ya está marcada como pagada el{" "}
        <strong>{fmtDate(payroll.paidAt!)}</strong> y vinculada a un movimiento
        bancario existente.
      </div>
      <Callout tone="warning">
        Si el vínculo es incorrecto, podés desvincularlo. La liquidación vuelve
        a &quot;impaga&quot; y el movimiento bancario queda libre para vincular a
        otro pago. Ninguno de los dos se borra.
      </Callout>
      {error && <Callout tone="negative">{error}</Callout>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="kg-focus"
          style={secondaryBtn}
        >
          Cerrar
        </button>
        <button
          type="button"
          onClick={handleUnlink}
          disabled={pending}
          className="kg-focus"
          style={{
            ...primaryBtn,
            background: "#EF4444",
            opacity: pending ? 0.7 : 1,
          }}
        >
          {pending ? "Desvinculando…" : "Desvincular pago"}
        </button>
      </div>
    </div>
  );
}

// ─── Caso: sin vincular → seleccionar movimiento ───────────────────────────

function PickMovement({
  payroll,
  unconciledMovements,
  onClose,
}: {
  readonly payroll: PayrollForLinking;
  readonly unconciledMovements: readonly UnconciledMovement[];
  readonly onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<LinkPayrollResult | null>(null);

  // Fecha de referencia para el scoring: due_date si está, si no period_end.
  // Es cuando "corresponde" pagar — un movimiento cercano a esa fecha suma.
  const referenceDate = payroll.dueDate ?? payroll.periodEnd;

  const scored = useMemo(
    () =>
      scoreExpenseMatches(
        {
          expenseAmountGross: payroll.totalAmount,
          expenseDateYmd: referenceDate,
          expenseCurrency: payroll.currency,
        },
        unconciledMovements,
      ),
    [payroll, referenceDate, unconciledMovements],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return scored;
    return scored.filter((s) => {
      const desc = s.movement.description.toLowerCase();
      const bank = s.movement.bankName.toLowerCase();
      const amount = String(s.movement.amount);
      return desc.includes(q) || bank.includes(q) || amount.includes(q);
    });
  }, [scored, query]);

  const selected = filtered.find((s) => s.movement.id === selectedId) ?? null;
  const currencyMismatch = selected?.currencyMatches === false;
  const bigAmountDiff = selected != null && selected.amountDiffPct > 0.05;

  function handleLink() {
    if (!selected) return;
    setResult(null);
    startTransition(async () => {
      const r = await linkPayrollToMovement(
        payroll.id,
        selected.movement.id,
      );
      setResult(r);
      if ("ok" in r) onClose();
    });
  }

  if (unconciledMovements.length === 0) {
    return (
      <EmptyState
        title="No hay movimientos sin conciliar"
        hint="Cargá el movimiento bancario de salida (el sueldo saliendo del banco) desde Financiero → Movimientos y volvé acá para vincularlo."
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Info de la liquidación para referencia */}
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
        <Metric label="Total" value={fMoney(payroll.totalAmount)} />
        <Metric label="Moneda" value={payroll.currency} />
        <Metric label="Vence" value={fmtDate(referenceDate)} />
      </div>

      <div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por descripción, banco o monto…"
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
          Ordenados por probabilidad de coincidencia (monto + fecha).
          Todos los movimientos sin conciliar están accesibles.
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
            Ningún movimiento coincide con &quot;{query}&quot;. Probá otra palabra o
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
              La moneda de la liquidación ({payroll.currency}) NO coincide con
              la del movimiento ({selected.movement.currency ?? "—"}).
              Confirmá que sea correcto antes de vincular.
            </div>
          )}
          {bigAmountDiff && (
            <div>
              La diferencia de monto es del{" "}
              {(selected.amountDiffPct * 100).toFixed(1)}%. Puede ser un
              adelanto parcial o una retención — confirmá que sea el pago
              correcto.
            </div>
          )}
        </Callout>
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
          Cancelar
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
          {pending ? "Vinculando…" : "Vincular pago"}
        </button>
      </div>

      <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
        Mostrando {fCount(filtered.length)} de{" "}
        {fCount(unconciledMovements.length)} movimientos sin conciliar.
      </div>
    </div>
  );
}

// ─── Row de un movimiento en la lista ─────────────────────────────────────

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
        background: selected ? "rgba(64,120,255,0.10)" : "transparent",
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
          {fmtDate(m.occurredAt)} · {m.bankName}
          {isIn && (
            <>
              {" "}
              ·{" "}
              <span style={{ color: "#EF4444" }}>
                ENTRADA (no puede pagar)
              </span>
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

// ─── Sub-componentes visuales ─────────────────────────────────────────────

function Metric({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
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
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
