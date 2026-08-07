"use client";

import { useState } from "react";

import { Drawer } from "@/components/kg/drawer";
import { fMoney } from "@/lib/finance/format";

import {
  MovementFormDrawer,
  type BankOption,
} from "./movement-form-drawer";
import type { MovementConciliation, MovementRowData } from "./movimientos-view";

// ═══════════════════════════════════════════════════════════════════════════
// Ficha del movimiento bancario.
//
// Reemplaza el flujo "Editar directo" del drawer viejo por una ficha unificada
// que:
//   1. Muestra los datos del movimiento.
//   2. Lista TODAS sus conciliaciones (factura/gasto/nómina/transferencia) con
//      link al módulo de origen — cada rubro tiene su propio módulo donde el
//      operador desvincula, edita o navega la contrapartida.
//   3. Botón "Editar movimiento" abre el drawer del form existente (nada de
//      duplicar lógica de edición acá).
//
// Los links a los módulos hijos usan searchParam `focus=<id>` en algunos casos
// (facturas ya lo soporta) o simplemente van al listado. Cuando aparezca el
// caso de "abrir directo la ficha", se agrega ahí.
// ═══════════════════════════════════════════════════════════════════════════

export interface MovementDetailDrawerProps {
  readonly row: MovementRowData;
  readonly banks: readonly BankOption[];
  readonly onClose: () => void;
}

export function MovementDetailDrawer({
  row,
  banks,
  onClose,
}: MovementDetailDrawerProps) {
  const [editing, setEditing] = useState(false);
  const conciliations = row.conciliations;
  const reconciledTotal = conciliations.reduce(
    (acc, c) => acc + Math.abs(c.amount),
    0,
  );
  const signedAmount = row.kind === "out" ? -row.amount : row.amount;

  return (
    <>
      <Drawer
        open={!editing}
        onClose={onClose}
        title="Ficha del movimiento"
        subtitle={`${row.bankName} · ${fmtDate(row.occurredAt)}`}
        width={620}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Resumen */}
          <div
            style={{
              padding: "12px 14px",
              borderRadius: "var(--kg-r-8)",
              background: "var(--kg-surface-2-solid)",
              border: "1px solid var(--kg-border-subtle)",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
              gap: 14,
            }}
          >
            <Metric
              label="Tipo"
              value={row.kind === "in" ? "Entrada" : "Salida"}
              tone={row.kind === "in" ? "positive" : "negative"}
            />
            <Metric label="Monto" value={fMoney(signedAmount)} />
            <Metric label="Fecha" value={fmtDate(row.occurredAt)} />
            <Metric
              label="Nº transacción"
              value={row.transactionNumber ?? "—"}
            />
          </div>

          {row.description && (
            <Section title="Descripción">
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  color: "var(--kg-text-1)",
                  lineHeight: 1.5,
                }}
              >
                {row.description}
              </p>
            </Section>
          )}

          {/* Conciliaciones */}
          <Section
            title={
              conciliations.length === 0
                ? "Conciliación"
                : `Conciliaciones (${conciliations.length})`
            }
            hint={
              conciliations.length === 0
                ? undefined
                : `Total conciliado: ${fMoney(reconciledTotal)} · monto del movimiento: ${fMoney(row.amount)}`
            }
          >
            {conciliations.length === 0 ? (
              <UnconciliatedCallout kind={row.kind} />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {conciliations.map((c, i) => (
                  <ConciliationCard
                    key={`${c.kind}-${c.id}-${i}`}
                    conciliation={c}
                  />
                ))}
              </div>
            )}
          </Section>

          {/* Acciones */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              paddingTop: 8,
              borderTop: "1px solid var(--kg-border-subtle)",
            }}
          >
            <button
              type="button"
              onClick={onClose}
              className="kg-focus"
              style={secondaryBtn}
            >
              Cerrar
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="kg-focus"
              style={primaryBtn}
              title="Editar los datos base del movimiento"
            >
              Editar movimiento
            </button>
          </div>
        </div>
      </Drawer>

      {editing && (
        <MovementFormDrawer
          mode="edit"
          open
          onClose={() => {
            setEditing(false);
            onClose();
          }}
          banks={banks}
          initial={{
            id: row.id,
            bankId: row.bankId,
            bankName: row.bankName,
            kind: row.kind,
            amount: row.amount,
            occurredAt: row.occurredAt,
            description: row.description,
            transactionNumber: row.transactionNumber,
          }}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Cards y helpers
// ═══════════════════════════════════════════════════════════════════════════

function ConciliationCard({
  conciliation,
}: {
  readonly conciliation: MovementConciliation;
}) {
  const meta = metaFor(conciliation);
  return (
    <a
      href={meta.href}
      className="kg-focus"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        borderRadius: "var(--kg-r-8)",
        background: "var(--kg-surface-2-solid)",
        border: "1px solid var(--kg-border-subtle)",
        textDecoration: "none",
        color: "var(--kg-text-1)",
      }}
      title={`Abrir ${meta.moduleLabel}`}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 34,
          height: 34,
          borderRadius: 8,
          background: meta.bg,
          color: meta.fg,
          fontSize: 12,
          fontWeight: 800,
        }}
      >
        {meta.chip}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12,
            color: "var(--kg-text-3)",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 0.4,
          }}
        >
          {meta.moduleLabel}
          {"role" in conciliation && conciliation.role !== "principal" && (
            <span
              style={{
                marginLeft: 6,
                padding: "1px 6px",
                borderRadius: 999,
                background: "rgba(138,138,153,0.15)",
                color: "var(--kg-text-3)",
                fontSize: 10,
              }}
            >
              {conciliation.role}
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: 13,
            color: "var(--kg-text-1)",
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {conciliation.label}
        </div>
      </div>
      <div
        className="kg-num"
        style={{
          fontSize: 13,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {fMoney(conciliation.amount)}
      </div>
      <span style={{ color: "var(--kg-text-3)", fontSize: 14 }}>›</span>
    </a>
  );
}

function metaFor(c: MovementConciliation): {
  chip: string;
  bg: string;
  fg: string;
  moduleLabel: string;
  href: string;
} {
  switch (c.kind) {
    case "invoice":
      return {
        chip: "F",
        bg: "rgba(0,208,132,0.18)",
        fg: "#00D084",
        moduleLabel: "Factura",
        href: `/financiero/facturas?focus=${c.id}`,
      };
    case "expense":
      return {
        chip: "G",
        bg: "rgba(239,68,68,0.18)",
        fg: "#EF4444",
        moduleLabel: "Gasto",
        href: `/financiero/gastos?focus=${c.id}`,
      };
    case "payroll":
      return {
        chip: "N",
        bg: "rgba(64,120,255,0.18)",
        fg: "#4078FF",
        moduleLabel: "Nómina",
        href: `/financiero/nomina?focus=${c.id}`,
      };
    case "transfer":
      return {
        chip: "T",
        bg: "rgba(255,184,0,0.18)",
        fg: "#FFB800",
        moduleLabel: "Transferencia a cliente",
        href: `/financiero/transferencias?focus=${c.id}`,
      };
  }
}

function UnconciliatedCallout({ kind }: { readonly kind: "in" | "out" }) {
  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: "var(--kg-r-8)",
        background: "rgba(255,184,0,0.10)",
        border: "1px solid #FFB800",
        color: "#FFB800",
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      <strong>Este movimiento no está atado a nada.</strong>
      <div style={{ marginTop: 6, color: "var(--kg-text-2)" }}>
        {kind === "in" ? (
          <>
            Si es un cobro por una factura pendiente, vinculalo desde{" "}
            <a
              href="/financiero/facturas?estado=emitidas"
              style={{ color: "var(--kg-accent-text)" }}
            >
              Facturas
            </a>{" "}
            (columna &quot;Vincular&quot;). Si es un ingreso operativo
            (reintegro, devolución), agregá una descripción explicativa desde
            &quot;Editar movimiento&quot;.
          </>
        ) : (
          <>
            Si paga un gasto, vinculalo desde{" "}
            <a
              href="/financiero/gastos?estado=impagos"
              style={{ color: "var(--kg-accent-text)" }}
            >
              Gastos
            </a>
            . Si paga una liquidación de nómina, andá a{" "}
            <a
              href="/financiero/nomina?paid=impago"
              style={{ color: "var(--kg-accent-text)" }}
            >
              Nómina
            </a>{" "}
            → &quot;Vincular pago&quot;. Si es una transferencia a un cliente,
            cerrá la liquidación desde{" "}
            <a
              href="/financiero/transferencias"
              style={{ color: "var(--kg-accent-text)" }}
            >
              Transferencias
            </a>
            .
          </>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  readonly title: string;
  readonly hint?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div>
        <h4
          style={{
            margin: 0,
            fontSize: 12,
            color: "var(--kg-text-3)",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          {title}
        </h4>
        {hint && (
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-3)", marginTop: 4 }}
          >
            {hint}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: "positive" | "negative";
}) {
  const color =
    tone === "positive"
      ? "#00D084"
      : tone === "negative"
        ? "#EF4444"
        : "var(--kg-text-1)";
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span
        className="kg-t7"
        style={{ color: "var(--kg-text-3)", fontSize: 10 }}
      >
        {label}
      </span>
      <strong
        style={{
          fontSize: 13,
          color,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </strong>
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
