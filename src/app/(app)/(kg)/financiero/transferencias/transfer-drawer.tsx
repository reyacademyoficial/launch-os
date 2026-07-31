"use client";

import { useState, useTransition } from "react";

import { Drawer } from "@/components/kg/drawer";
import { fMoney } from "@/lib/finance/format";

import { transferToClient } from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer para transferir el saldo pendiente de una liquidación al cliente.
// Un solo formulario: selector de banco + fecha efectiva. Al confirmar,
// llama a la RPC atómica (bank_movement + client_transfers + status update).
// ═══════════════════════════════════════════════════════════════════════════

export interface BankOption {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
}

export interface PendingSettlement {
  readonly id: string;
  readonly projectName: string;
  readonly launchName: string;
  readonly pending: number;
  readonly closedAt: string | null;
}

export interface TransferDrawerProps {
  readonly settlement: PendingSettlement;
  readonly banks: readonly BankOption[];
  readonly onClose: () => void;
}

export function TransferDrawer({
  settlement,
  banks,
  onClose,
}: TransferDrawerProps) {
  const [bankId, setBankId] = useState<string>("");
  const [transferredAt, setTransferredAt] = useState<string>(todayYmd());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const banksActive = banks.filter((b) => b.active);

  function handleSubmit() {
    setError(null);
    if (!bankId) {
      setError("Elegí un banco.");
      return;
    }
    startTransition(async () => {
      const res = await transferToClient({
        settlementId: settlement.id,
        bankId,
        transferredAt,
      });
      if (res.ok) setDone(true);
      else setError(res.error);
    });
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title="Transferir al cliente"
      subtitle={`${settlement.projectName} · ${settlement.launchName}`}
      width={520}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            className="kg-focus"
            style={secondaryBtn}
          >
            {done ? "Cerrar" : "Cancelar"}
          </button>
          {!done && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={pending || banksActive.length === 0}
              className="kg-focus"
              style={{
                ...primaryBtn,
                opacity: pending || banksActive.length === 0 ? 0.7 : 1,
              }}
            >
              {pending ? "Transfiriendo…" : "Confirmar transferencia"}
            </button>
          )}
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div
          style={{
            padding: "12px 14px",
            borderRadius: "var(--kg-r-8)",
            background: "var(--kg-surface-2-solid)",
            border: "1px solid var(--kg-border-subtle)",
            display: "flex",
            gap: 20,
            flexWrap: "wrap",
          }}
        >
          <Metric
            label="Saldo a transferir"
            value={fMoney(settlement.pending)}
            accent
          />
          {settlement.closedAt && (
            <Metric label="Cerrada" value={fmtDate(settlement.closedAt)} />
          )}
        </div>

        <Field label="Banco de origen" htmlFor="bank_id" required>
          <select
            id="bank_id"
            required
            value={bankId}
            onChange={(e) => setBankId(e.target.value)}
            style={inputStyle}
          >
            <option value="">Elegí un banco…</option>
            {banksActive.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          {banksActive.length === 0 && (
            <div
              className="kg-t7"
              style={{ color: "#EF4444", marginTop: 6 }}
            >
              No hay bancos activos configurados. Creá uno en /financiero/bancos.
            </div>
          )}
        </Field>

        <Field label="Fecha de la transferencia" htmlFor="transferred_at" required>
          <input
            id="transferred_at"
            type="date"
            required
            value={transferredAt}
            onChange={(e) => setTransferredAt(e.target.value)}
            style={inputStyle}
          />
        </Field>

        <Callout tone="warning">
          Esta acción es atómica: registra un movimiento bancario de salida
          por <strong>{fMoney(settlement.pending)}</strong> en el banco elegido,
          crea un registro de transferencia enlazado al movimiento y marca la
          liquidación como <strong>transferida</strong>. No hay reversa
          automática.
        </Callout>

        {done && (
          <Callout tone="positive">
            Transferencia registrada. La liquidación pasó a "transferida" y el
            saldo pendiente quedó en cero.
          </Callout>
        )}

        {error && <Callout tone="negative">{error}</Callout>}
      </div>
    </Drawer>
  );
}

// ─── Sub-componentes ─────────────────────────────────────────────────────

function Metric({
  label,
  value,
  accent,
}: {
  readonly label: string;
  readonly value: string;
  readonly accent?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
        {label}
      </span>
      <strong
        style={{
          fontSize: 15,
          fontWeight: 700,
          color: accent ? "var(--kg-accent-text)" : "var(--kg-text-1)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </strong>
    </div>
  );
}

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

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  borderRadius: "var(--kg-r-8)",
  background: "var(--kg-surface-2-solid)",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-1)",
  fontSize: 13,
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

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
