"use client";

import { useState } from "react";

import { StateDot } from "@/components/kg/state-dot";
import {
  SessionFormDrawer,
  type OwnerOption,
  type PersonOption,
  type PieceOption,
  type SessionInitial,
} from "@/components/marketing/session-form-drawer";
import { panelActionSecondaryBtn } from "@/components/kg/form-primitives";

// ═══════════════════════════════════════════════════════════════════════════
// Panel "Pieces con fecha planificada sin sesión".
//
// Aparece en /marketing/grabacion cuando hay pieces con
// `scheduled_recording_at` no null y `recording_session_id` null. El objetivo
// es cerrar el gap entre "planifiqué la fecha en la piece" y "existe la
// sesión en el calendario con detalles". Un click agrupa por owner+día y
// abre el drawer de sesión con owner + fecha + pieces pre-seleccionadas.
//
// La agrupación es por (owner, día calendario local) — pieces del mismo dueño
// que caen el mismo día se ofrecen como una sola sesión. El usuario todavía
// puede editar la hora exacta en el drawer y quitar pieces si no quiere
// juntarlas todas.
//
// La page sólo monta este componente si hay pendientes — no hace falta un
// early return acá.
// ═══════════════════════════════════════════════════════════════════════════

export interface PendingPiece {
  readonly id: string;
  readonly title: string;
  readonly contentOwnerId: string;
  readonly ownerName: string;
  readonly scheduledRecordingAt: string; // ISO — no null por definición
}

export interface PendingGroup {
  readonly ownerId: string;
  readonly ownerName: string;
  readonly dateKey: string; // YYYY-MM-DD
  readonly firstIsoAt: string; // primera hora del día — para el preset
  readonly pieces: readonly PendingPiece[];
}

export function PendingPiecesPanel({
  groups,
  ownerOptions,
  personOptions,
  pieceOptions,
}: {
  readonly groups: readonly PendingGroup[];
  readonly ownerOptions: readonly OwnerOption[];
  readonly personOptions: readonly PersonOption[];
  readonly pieceOptions: readonly PieceOption[];
}) {
  const [openGroup, setOpenGroup] = useState<PendingGroup | null>(null);

  const initial: SessionInitial | undefined =
    openGroup != null
      ? {
          contentOwnerId: openGroup.ownerId,
          scheduledAt: openGroup.firstIsoAt,
          pieceIds: openGroup.pieces.map((p) => p.id),
        }
      : undefined;

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {groups.map((g) => (
          <div
            key={`${g.ownerId}::${g.dateKey}`}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              padding: "10px 14px",
              borderRadius: "var(--kg-r-8)",
              background: "var(--kg-surface-2-solid)",
              border: "1px solid var(--kg-border-subtle)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <StateDot tone="warning" />
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span
                  style={{
                    color: "var(--kg-text-1)",
                    fontWeight: 600,
                    fontSize: 13,
                  }}
                >
                  {g.ownerName} · {formatDay(g.dateKey)}
                </span>
                <span
                  className="kg-t7"
                  style={{ color: "var(--kg-text-3)", marginTop: 2 }}
                >
                  {g.pieces.length} piece{g.pieces.length === 1 ? "" : "s"} sin
                  sesión — {g.pieces.map((p) => p.title).join(" · ")}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpenGroup(g)}
              className="kg-focus"
              style={panelActionSecondaryBtn}
              title="Abre el drawer de sesión con estas pieces pre-cargadas"
            >
              Crear sesión
            </button>
          </div>
        ))}
      </div>

      <SessionFormDrawer
        mode="create"
        open={openGroup != null}
        onClose={() => setOpenGroup(null)}
        ownerOptions={ownerOptions}
        personOptions={personOptions}
        pieceOptions={pieceOptions}
        initial={initial}
        initialKey={
          openGroup != null ? `${openGroup.ownerId}::${openGroup.dateKey}` : undefined
        }
      />
    </>
  );
}

function formatDay(key: string): string {
  const [y, m, d] = key.split("-");
  if (!y || !m || !d) return key;
  return `${d}/${m}/${y}`;
}
