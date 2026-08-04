"use client";

import { useState, useTransition } from "react";

import { Drawer } from "@/components/kg/drawer";
import { EmptyState } from "@/components/kg/empty-state";
import { StatusPill } from "@/components/kg/status-pill";

import { attachProjectToClient } from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer para atar un project existente (sin cliente) al cliente actual.
//
// La lista de projects disponibles la trae el server (proyects con
// client_id IS NULL en la org). Si no hay ninguno, el drawer muestra un
// EmptyState explicativo — no es un error, es un estado normal cuando
// todos los projects ya tienen dueño.
// ═══════════════════════════════════════════════════════════════════════════

export interface AvailableProject {
  readonly id: string;
  readonly name: string;
  readonly businessName: string | null;
  readonly ownership: "propia" | "externa";
}

export function AttachProjectDrawer({
  clientId,
  open,
  onClose,
  available,
}: {
  readonly clientId: string;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly available: readonly AvailableProject[];
}) {
  if (!open) return null;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Atar project al cliente"
      subtitle="Elegí un project sin cliente asignado. Va a quedar visible en la ficha y sus datos financieros van a contar para el LTV."
      width={560}
    >
      <AttachProjectBody
        clientId={clientId}
        available={available}
        onClose={onClose}
      />
    </Drawer>
  );
}

function AttachProjectBody({
  clientId,
  available,
  onClose,
}: {
  readonly clientId: string;
  readonly available: readonly AvailableProject[];
  readonly onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [attachingId, setAttachingId] = useState<string | null>(null);

  function handleAttach(projectId: string) {
    setError(null);
    setAttachingId(projectId);
    startTransition(async () => {
      const result = await attachProjectToClient(clientId, projectId);
      setAttachingId(null);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      onClose();
    });
  }

  if (available.length === 0) {
    return (
      <EmptyState
        title="No hay projects sin cliente"
        hint="Todos los projects de la organización ya están atados a algún cliente. Si querés mover uno, entrá al cliente actual del project y desatalo primero."
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

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {available.map((p) => {
          const isAttaching = attachingId === p.id;
          return (
            <div
              key={p.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 14px",
                borderRadius: "var(--kg-r-8)",
                background: "var(--kg-surface-2-solid)",
                border: "1px solid var(--kg-border-subtle)",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  className="kg-t6"
                  style={{
                    color: "var(--kg-text-1)",
                    fontWeight: 600,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {p.name}
                </div>
                <div
                  className="kg-t7"
                  style={{
                    color: "var(--kg-text-3)",
                    marginTop: 2,
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <StatusPill
                    text={p.ownership === "propia" ? "Propio" : "Externo"}
                    tone={
                      p.ownership === "propia"
                        ? "var(--kg-accent-500)"
                        : "var(--kg-neutral-500)"
                    }
                  />
                  {p.businessName && (
                    <span style={{ color: "var(--kg-text-3)" }}>
                      {p.businessName}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleAttach(p.id)}
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
                  opacity: pending && !isAttaching ? 0.4 : 1,
                }}
              >
                {isAttaching ? "Atando…" : "Atar"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
