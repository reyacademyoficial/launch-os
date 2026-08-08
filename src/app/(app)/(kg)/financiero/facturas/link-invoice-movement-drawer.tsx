"use client";

import { useMemo, useState, useTransition } from "react";

import { Drawer } from "@/components/kg/drawer";
import { EmptyState } from "@/components/kg/empty-state";
import { fCount, fMoney } from "@/lib/finance/format";
import {
  scoreInvoiceMatches,
  type InvoiceMovementCandidate,
} from "@/lib/finance/invoice-matching";

import {
  linkInvoiceToMovement,
  unlinkInvoiceFromMovement,
  type InvoiceMovementRole,
  type LinkInvoiceMovementResult,
} from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer para conciliar una factura con uno o más movimientos bancarios.
//
// Espeja el flujo de `LinkPaymentDrawer` de gastos: muestra los movimientos
// ya vinculados arriba (con opción de desvincular) y debajo un selector
// ordenado por score para agregar más. Soporta múltiples movimientos por
// factura — típico caso: cobro principal + comisión de pasarela (Wise,
// Stripe) descontada aparte.
//
// El scoring espera kind='in' para el rol 'principal'. Un movimiento 'out'
// aparece igual al final del listado por si el operador quiere vincularlo
// como 'comision' u 'otro'.
// ═══════════════════════════════════════════════════════════════════════════

export interface InvoiceLinkedMovement {
  readonly movementId: string;
  readonly role: InvoiceMovementRole;
  readonly amount: number;
  readonly kind: "in" | "out";
  readonly occurredAt: string;
  readonly description: string | null;
  readonly bankName: string;
}

export interface InvoiceForLinking {
  readonly id: string;
  readonly invoiceNumber: string | null;
  readonly description: string;
  readonly amountGross: number;
  readonly currency: string;
  readonly issueDate: string;
  readonly status: "emitida" | "cobrada" | "vencida" | "anulada";
  readonly linkedMovements: readonly InvoiceLinkedMovement[];
}

export interface UnconciledMovementForInvoice extends InvoiceMovementCandidate {
  readonly bankName: string;
  readonly projectName: string;
  readonly description: string;
}

export interface LinkInvoiceMovementDrawerProps {
  readonly invoice: InvoiceForLinking;
  readonly unconciledMovements: readonly UnconciledMovementForInvoice[];
  readonly onClose: () => void;
}

export function LinkInvoiceMovementDrawer({
  invoice,
  unconciledMovements,
  onClose,
}: LinkInvoiceMovementDrawerProps) {
  const linked = invoice.linkedMovements;
  const hasLinked = linked.length > 0;
  const subtitle = invoice.invoiceNumber
    ? `Nº ${invoice.invoiceNumber} · ${invoice.description}`
    : invoice.description;
  return (
    <Drawer
      open
      onClose={onClose}
      title={hasLinked ? "Vincular más movimientos" : "Conciliar factura"}
      subtitle={subtitle}
      width={720}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {hasLinked && (
          <LinkedMovementsList
            invoice={invoice}
            movements={linked}
            onClose={onClose}
          />
        )}
        {invoice.status === "anulada" ? (
          <div
            style={{
              padding: "10px 14px",
              borderRadius: "var(--kg-r-8)",
              background: "rgba(239,68,68,0.10)",
              border: "1px solid #EF4444",
              color: "#EF4444",
              fontSize: 12,
            }}
          >
            La factura está anulada — no se pueden vincular nuevos movimientos.
          </div>
        ) : (
          <PickMovement
            invoice={invoice}
            unconciledMovements={unconciledMovements}
            onClose={onClose}
            allowClose={!hasLinked}
          />
        )}
      </div>
    </Drawer>
  );
}

// ─── Movimientos ya vinculados ────────────────────────────────────────────

function LinkedMovementsList({
  invoice,
  movements,
  onClose,
}: {
  readonly invoice: InvoiceForLinking;
  readonly movements: readonly InvoiceLinkedMovement[];
  readonly onClose: () => void;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleUnlink(movementId: string) {
    if (
      !confirm(
        "¿Desvincular este movimiento? Si era el 'principal' que cobraba la factura, la factura vuelve a 'emitida'.",
      )
    ) {
      return;
    }
    setError(null);
    setPendingId(movementId);
    startTransition(async () => {
      const res = await unlinkInvoiceFromMovement(invoice.id, movementId);
      setPendingId(null);
      if ("error" in res) setError(res.error);
    });
  }

  const principalSum = movements
    .filter((m) => m.role === "principal" && m.kind === "in")
    .reduce((acc, m) => acc + m.amount, 0);
  const commissionSum = movements
    .filter((m) => m.role === "comision")
    .reduce((acc, m) => acc + m.amount, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        className="kg-t7"
        style={{ color: "var(--kg-text-2)", fontWeight: 700 }}
      >
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
        Principal cobrado:{" "}
        <b style={{ color: "var(--kg-text-1)" }}>{fMoney(principalSum)}</b>
        {commissionSum > 0 && (
          <>
            {" · "}Comisión:{" "}
            <b style={{ color: "var(--kg-text-1)" }}>{fMoney(commissionSum)}</b>
          </>
        )}
        {" · "}Factura bruta:{" "}
        <b style={{ color: "var(--kg-text-1)" }}>
          {fMoney(invoice.amountGross)}
        </b>
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

function RolePill({ role }: { readonly role: InvoiceMovementRole }) {
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

// ─── Selector de movimiento ──────────────────────────────────────────────

function PickMovement({
  invoice,
  unconciledMovements,
  onClose,
  allowClose,
}: {
  readonly invoice: InvoiceForLinking;
  readonly unconciledMovements: readonly UnconciledMovementForInvoice[];
  readonly onClose: () => void;
  readonly allowClose: boolean;
}) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] =
    useState<InvoiceMovementRole>("principal");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<LinkInvoiceMovementResult | null>(null);

  const scored = useMemo(
    () =>
      scoreInvoiceMatches(
        {
          invoiceAmountGross: invoice.amountGross,
          invoiceDateYmd: invoice.issueDate,
          invoiceCurrency: invoice.currency,
        },
        unconciledMovements,
      ),
    [invoice, unconciledMovements],
  );

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
  const principalWithOut =
    selected != null &&
    selectedRole === "principal" &&
    selected.movement.kind === "out";

  function handleLink() {
    if (!selected) return;
    setResult(null);
    startTransition(async () => {
      const r = await linkInvoiceToMovement(
        invoice.id,
        selected.movement.id,
        selectedRole,
      );
      setResult(r);
      if ("ok" in r) {
        setSelectedId(null);
        setQuery("");
      }
    });
  }

  if (unconciledMovements.length === 0) {
    return (
      <EmptyState
        title="No hay movimientos sin conciliar"
        hint="Cargá movimientos bancarios en la pestaña Movimientos (o importalos desde el Excel del banco) y volvé para vincularlos acá."
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Ficha resumida de la factura */}
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
        <Metric label="Monto" value={fMoney(invoice.amountGross)} />
        <Metric label="Moneda" value={invoice.currency} />
        <Metric label="Emisión" value={fmtDate(invoice.issueDate)} />
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
            Ningún movimiento coincide con &quot;{query}&quot;. Probá otra
            palabra o limpiá la búsqueda.
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
              La moneda de la factura ({invoice.currency}) NO coincide con la
              del movimiento ({selected.movement.currency ?? "—"}). Confirmá
              que sea correcto antes de vincular.
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

      {principalWithOut && (
        <Callout tone="negative">
          Un movimiento de <b>salida</b> no puede ser el principal de una
          factura (el principal cobra, no paga). Cambiá el rol a
          &quot;comisión&quot; u &quot;otro&quot;, o elegí un movimiento de
          entrada.
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
                    ? "El cobro principal de la factura (exige movimiento kind=in)"
                    : r === "comision"
                      ? "Fee de pasarela o banco descontado del cobro"
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
          disabled={pending || !selected || principalWithOut}
          className="kg-focus"
          style={{
            ...primaryBtn,
            opacity: pending || !selected || principalWithOut ? 0.6 : 1,
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

// ─── Row del selector ────────────────────────────────────────────────────

function MovementRow({
  scored,
  selected,
  onSelect,
}: {
  readonly scored: ReturnType<
    typeof scoreInvoiceMatches<UnconciledMovementForInvoice>
  >[number];
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const m = scored.movement;
  const isOut = m.kind === "out";
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
          {fmtDate(m.occurredAt)} · {m.projectName} · {m.bankName}
          {isOut && (
            <>
              {" "}
              ·{" "}
              <span style={{ color: "#EF4444" }}>
                SALIDA (no puede ser el principal)
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

// ─── Sub-componentes visuales ────────────────────────────────────────────

function Metric({ label, value }: { readonly label: string; readonly value: string }) {
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
