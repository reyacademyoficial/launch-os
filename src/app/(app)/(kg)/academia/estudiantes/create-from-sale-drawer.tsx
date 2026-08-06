"use client";

import { useState, useTransition } from "react";

import { Drawer } from "@/components/kg/drawer";
import { EmptyState } from "@/components/kg/empty-state";
import { fMoney } from "@/lib/finance/format";

import { createStudentFromSale } from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer para dar de alta un estudiante desde una venta de LaunchOS.
//
// Lista las sales de products-course cuyo lead todavía no fue registrado
// como student (matching por email/phone). Cada row es "un comprador
// potencial" — el operador elige y confirma. El action lee lead y crea
// el student con auto-fill.
// ═══════════════════════════════════════════════════════════════════════════

export interface PendingSale {
  readonly saleId: string;
  readonly leadName: string;
  readonly leadEmail: string | null;
  readonly leadPhone: string | null;
  readonly productName: string;
  readonly projectName: string;
  readonly amount: number;
  readonly currency: "ARS" | "USD";
  readonly createdAt: string;
}

export function CreateFromSaleDrawer({
  open,
  onClose,
  pendingSales,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly pendingSales: readonly PendingSale[];
}) {
  if (!open) return null;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Alta desde comprador"
      subtitle="Estudiantes potenciales: compradores de productos-curso que aún no están en la lista de estudiantes."
      width={640}
    >
      <CreateFromSaleBody pendingSales={pendingSales} onClose={onClose} />
    </Drawer>
  );
}

function CreateFromSaleBody({
  pendingSales,
  onClose,
}: {
  readonly pendingSales: readonly PendingSale[];
  readonly onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [creatingId, setCreatingId] = useState<string | null>(null);

  function handleCreate(sale: PendingSale) {
    setError(null);
    setCreatingId(sale.saleId);
    startTransition(async () => {
      const result = await createStudentFromSale({
        saleId: sale.saleId,
        notes: null,
      });
      setCreatingId(null);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      // No cerramos el drawer — el operador puede seguir cargando otros.
      // El listado se re-fetchea por revalidatePath.
    });
  }

  if (pendingSales.length === 0) {
    return (
      <EmptyState
        title="No hay compradores pendientes"
        hint="Todos los compradores de products-course ya están registrados como estudiantes. Si esperabas ver alguno acá, verificá que el producto de la venta esté configurado como curso en la pestaña Cursos."
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {error && (
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
          {error}
        </div>
      )}

      <div
        className="kg-t7"
        style={{ color: "var(--kg-text-3)", padding: "0 2px 4px 2px" }}
      >
        {pendingSales.length}{" "}
        {pendingSales.length === 1
          ? "comprador pendiente"
          : "compradores pendientes"}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {pendingSales.map((s) => {
          const isCreating = creatingId === s.saleId;
          return (
            <div
              key={s.saleId}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 12,
                padding: "12px 14px",
                borderRadius: "var(--kg-r-8)",
                background: "var(--kg-surface-2-solid)",
                border: "1px solid var(--kg-border-subtle)",
                alignItems: "center",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    color: "var(--kg-text-1)",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {s.leadName}
                </div>
                <div
                  className="kg-t7"
                  style={{
                    color: "var(--kg-text-3)",
                    marginTop: 2,
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 10,
                  }}
                >
                  {s.leadEmail && <span>{s.leadEmail}</span>}
                  {s.leadPhone && <span>{s.leadPhone}</span>}
                </div>
                <div
                  className="kg-t7"
                  style={{
                    color: "var(--kg-text-3)",
                    marginTop: 4,
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 10,
                  }}
                >
                  <span>
                    📚 {s.productName}{" "}
                    <span style={{ color: "var(--kg-text-3)" }}>
                      · {s.projectName}
                    </span>
                  </span>
                  <span>
                    💵 {formatMoney(s.amount, s.currency)}
                  </span>
                  <span>{formatDate(s.createdAt)}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleCreate(s)}
                disabled={pending}
                className="kg-focus"
                style={{
                  padding: "6px 14px",
                  borderRadius: 999,
                  background: "var(--kg-accent-500)",
                  border: "none",
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: pending ? "wait" : "pointer",
                  opacity: pending && !isCreating ? 0.4 : 1,
                }}
              >
                {isCreating ? "Creando…" : "Crear estudiante"}
              </button>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="kg-focus"
          style={{
            padding: "8px 16px",
            borderRadius: 999,
            background: "transparent",
            border: "1px solid var(--kg-border-subtle)",
            color: "var(--kg-text-2)",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Cerrar
        </button>
      </div>
    </div>
  );
}

function formatMoney(amount: number, currency: "ARS" | "USD"): string {
  const raw = fMoney(amount);
  const prefix = currency === "USD" ? "US$" : "AR$";
  return raw.replace(/^(-?)\$/, `$1${prefix} `);
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}
