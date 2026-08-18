"use client";

import { useState } from "react";

import {
  LinkCommissionDrawer,
  type TransferLinkedMovement,
  type UnconciledOutMovement,
} from "./link-commission-drawer";

// ═══════════════════════════════════════════════════════════════════════════
// Botón + drawer para vincular comisiones bancarias a una transferencia.
// Se usa en la columna "Comisiones" de la tabla de transferencias.
//
// Solo aparece habilitado cuando la fila tiene direction='transferido' — no
// tiene sentido asociar comisiones a devengos ('a_favor_cliente'), que aún
// no movieron plata. El caller decide si renderiza o no.
// ═══════════════════════════════════════════════════════════════════════════

export function CommissionActionCell({
  transferId,
  projectName,
  amount,
  date,
  linkedMovements,
  unconciledMovements,
}: {
  readonly transferId: string;
  readonly projectName: string;
  readonly amount: number;
  readonly date: string;
  readonly linkedMovements: readonly TransferLinkedMovement[];
  readonly unconciledMovements: readonly UnconciledOutMovement[];
}) {
  const [open, setOpen] = useState(false);
  const commissionCount = linkedMovements.filter(
    (m) => m.role === "comision",
  ).length;
  const commissionSum = linkedMovements
    .filter((m) => m.role === "comision")
    .reduce((a, m) => a + m.amount, 0);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="kg-focus"
        style={{
          padding: "3px 10px",
          borderRadius: 999,
          background:
            commissionCount > 0
              ? "rgba(255,184,0,0.15)"
              : "transparent",
          color:
            commissionCount > 0 ? "#FFB800" : "var(--kg-text-2)",
          border:
            commissionCount > 0
              ? "1px solid #FFB800"
              : "1px solid var(--kg-border-subtle)",
          fontSize: 11,
          fontWeight: 700,
          cursor: "pointer",
        }}
        title={
          commissionCount > 0
            ? `${commissionCount} comisión(es) vinculada(s). Click para ver o agregar más.`
            : "Agregar comisión bancaria de esta transferencia"
        }
      >
        {commissionCount > 0
          ? `${commissionCount} · ${fmtMoneyCompact(commissionSum)}`
          : "+ Comisión"}
      </button>

      {open && (
        <LinkCommissionDrawer
          transfer={{
            id: transferId,
            projectName,
            amount,
            date,
            linkedMovements,
          }}
          unconciledMovements={unconciledMovements}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function fmtMoneyCompact(n: number): string {
  if (n === 0) return "0";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(0);
}
