"use client";

import { useMemo, useState, useTransition } from "react";

import { Drawer } from "@/components/kg/drawer";
import { EmptyState } from "@/components/kg/empty-state";
import { fCount, fMoney } from "@/lib/finance/format";

import {
  linkTransferToMovement,
  unlinkTransferFromMovement,
  type LinkTransferResult,
} from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer para vincular comisiones bancarias a una transferencia a cliente.
//
// La RPC transfer_to_client (0102) crea el bank_movement out (principal) y
// linkea via col vieja + backfill al bridge. Este drawer agrega los fees
// bancarios que el banco cobró al hacer el giro — típicamente Wise,
// transferencia internacional, cash-out de MP.
//
// Solo listamos movimientos kind='out' sin conciliar como candidatos. El
// role del insert es 'comision' por default; el usuario puede elegir 'otro'
// si el movimiento es un ajuste.
// ═══════════════════════════════════════════════════════════════════════════

export type TransferMovementRole = "comision" | "otro";

export interface TransferLinkedMovement {
  readonly movementId: string;
  readonly role: "principal" | "comision" | "otro";
  readonly amount: number;
  readonly kind: "in" | "out";
  readonly occurredAt: string;
  readonly description: string | null;
  readonly bankName: string;
}

export interface UnconciledOutMovement {
  readonly id: string;
  readonly amount: number;
  readonly occurredAt: string;
  readonly bankName: string;
  readonly description: string;
}

export interface TransferForLinking {
  readonly id: string;
  readonly projectName: string;
  readonly amount: number;
  readonly date: string;
  readonly linkedMovements: readonly TransferLinkedMovement[];
}

export interface LinkCommissionDrawerProps {
  readonly transfer: TransferForLinking;
  readonly unconciledMovements: readonly UnconciledOutMovement[];
  readonly onClose: () => void;
}

export function LinkCommissionDrawer({
  transfer,
  unconciledMovements,
  onClose,
}: LinkCommissionDrawerProps) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] =
    useState<TransferMovementRole>("comision");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [unlinkPendingId, setUnlinkPendingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return unconciledMovements;
    return unconciledMovements.filter((m) => {
      const desc = m.description.toLowerCase();
      const bank = m.bankName.toLowerCase();
      const amt = String(m.amount);
      return desc.includes(q) || bank.includes(q) || amt.includes(q);
    });
  }, [unconciledMovements, query]);

  function handleLink() {
    if (!selectedId) return;
    setError(null);
    startTransition(async () => {
      const r = await linkTransferToMovement(
        transfer.id,
        selectedId,
        selectedRole,
      );
      if ("error" in r) setError(r.error);
      else {
        setSelectedId(null);
        setQuery("");
      }
    });
  }

  function handleUnlink(movementId: string) {
    setError(null);
    setUnlinkPendingId(movementId);
    startTransition(async () => {
      const r = await unlinkTransferFromMovement(transfer.id, movementId);
      setUnlinkPendingId(null);
      if ("error" in r) setError(r.error);
    });
  }

  const linked = transfer.linkedMovements;
  const principalSum = linked
    .filter((m) => m.role === "principal")
    .reduce((a, m) => a + m.amount, 0);
  const commissionSum = linked
    .filter((m) => m.role === "comision")
    .reduce((a, m) => a + m.amount, 0);

  return (
    <Drawer
      open
      onClose={onClose}
      title="Comisiones de la transferencia"
      subtitle={`${transfer.projectName} · ${fmtDate(transfer.date)}`}
      width={640}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Info transferencia */}
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
          <Metric label="Monto transferido" value={fMoney(transfer.amount)} />
          <Metric label="Fecha" value={fmtDate(transfer.date)} />
        </div>

        {/* Lista de vínculos existentes */}
        {linked.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div
              className="kg-t7"
              style={{ color: "var(--kg-text-2)", fontWeight: 700 }}
            >
              Movimientos vinculados ({linked.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {linked.map((m) => (
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
                    disabled={
                      pending && unlinkPendingId === m.movementId
                    }
                    className="kg-focus"
                    style={{
                      ...secondaryBtn,
                      color: "#EF4444",
                      borderColor: "#EF4444",
                      padding: "3px 10px",
                      fontSize: 10,
                      opacity:
                        pending && unlinkPendingId === m.movementId ? 0.6 : 1,
                    }}
                    title={
                      m.role === "principal"
                        ? "Desvincular el movimiento principal (creado por la RPC transfer_to_client)"
                        : "Desvincular"
                    }
                  >
                    {pending && unlinkPendingId === m.movementId
                      ? "…"
                      : "Desvincular"}
                  </button>
                </div>
              ))}
            </div>
            <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
              Transferido:{" "}
              <b style={{ color: "var(--kg-text-1)" }}>
                {fMoney(principalSum)}
              </b>
              {commissionSum > 0 && (
                <>
                  {" · "}Comisión bancaria:{" "}
                  <b style={{ color: "var(--kg-text-1)" }}>
                    {fMoney(commissionSum)}
                  </b>{" "}
                  <span style={{ color: "var(--kg-text-3)" }}>
                    (
                    {principalSum > 0
                      ? ((commissionSum / principalSum) * 100).toFixed(1)
                      : "—"}
                    % del monto)
                  </span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Selector de movimiento */}
        {unconciledMovements.length === 0 ? (
          <EmptyState
            title="No hay movimientos de salida sin conciliar"
            hint="Cargá primero el movimiento bancario de comisión desde Financiero → Movimientos y volvé acá para vincularlo."
          />
        ) : (
          <>
            <div>
              <div
                className="kg-t7"
                style={{ color: "var(--kg-text-2)", fontWeight: 700 }}
              >
                Agregar comisión bancaria
              </div>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por descripción, banco o monto…"
                className="kg-focus"
                style={{
                  width: "100%",
                  marginTop: 6,
                  padding: "9px 12px",
                  borderRadius: "var(--kg-r-8)",
                  background: "var(--kg-surface-2-solid)",
                  border: "1px solid var(--kg-border-subtle)",
                  color: "var(--kg-text-1)",
                  fontSize: 13,
                }}
              />
            </div>

            <div
              style={{
                border: "1px solid var(--kg-border-subtle)",
                borderRadius: "var(--kg-r-8)",
                maxHeight: 300,
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
                  Ningún movimiento coincide con &quot;{query}&quot;.
                </div>
              ) : (
                filtered.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSelectedId(m.id)}
                    aria-pressed={selectedId === m.id}
                    className="kg-focus"
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 14px",
                      background:
                        selectedId === m.id
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
                        style={{
                          color: "var(--kg-text-3)",
                          marginTop: 2,
                        }}
                      >
                        {fmtDate(m.occurredAt)} · {m.bankName}
                      </div>
                    </div>
                    <div
                      className="kg-num"
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: "#EF4444",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      −{fMoney(m.amount)}
                    </div>
                  </button>
                ))
              )}
            </div>

            {selectedId && (
              <div>
                <div
                  className="kg-t7"
                  style={{ color: "var(--kg-text-3)", marginBottom: 6 }}
                >
                  Rol del vínculo
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {(["comision", "otro"] as const).map((r) => (
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
                        r === "comision"
                          ? "Fee bancario/pasarela cobrado al hacer el giro"
                          : "Ajuste u otro movimiento vinculado"
                      }
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {error && <Callout tone="negative">{error}</Callout>}

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span
                className="kg-t7"
                style={{ color: "var(--kg-text-3)" }}
              >
                {fCount(filtered.length)} de{" "}
                {fCount(unconciledMovements.length)}
              </span>
              <div style={{ display: "flex", gap: 8 }}>
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
                  onClick={handleLink}
                  disabled={pending || !selectedId}
                  className="kg-focus"
                  style={{
                    ...primaryBtn,
                    opacity: pending || !selectedId ? 0.6 : 1,
                  }}
                >
                  {pending && !unlinkPendingId
                    ? "Vinculando…"
                    : "Vincular comisión"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}

function RolePill({
  role,
}: {
  readonly role: "principal" | "comision" | "otro";
}) {
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
  const s = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
