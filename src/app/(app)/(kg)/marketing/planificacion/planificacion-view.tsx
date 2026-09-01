"use client";

import { useState, useTransition } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { StatusPill } from "@/components/kg/status-pill";
import {
  SessionFormDrawer,
  type OwnerOption as SessionOwnerOption,
  type PersonOption,
  type PieceOption,
  type SessionInitial,
} from "@/components/marketing/session-form-drawer";
import {
  CATEGORY_LABEL,
  FORMAT_LABEL,
  PLATFORM_LABEL,
  STAGE_LABEL,
  STAGE_TONE,
  type MarketingCategory,
  type MarketingFormat,
  type MarketingPlatform,
  type MarketingStage,
} from "@/lib/marketing/types";

import { setPieceStage } from "./actions";
import {
  PieceFormDrawer,
  type OwnerOption,
  type PieceInitial,
} from "./piece-form-drawer";

// ═══════════════════════════════════════════════════════════════════════════
// Tabla de content_pieces + drawer create/edit + acciones stage-aware.
//
// Acciones por fila:
//   - Editar: abre drawer con initial pre-cargado
//   - Descartar (si stage != descartado): setStage='descartado'
//   - Restaurar (si stage == descartado): setStage='planificado'
//
// Los stages intermedios (en_grabacion, en_edicion, listo_para_subir,
// publicado) los mueve el trigger de 0165 — no aparecen como acción manual.
// ═══════════════════════════════════════════════════════════════════════════

export interface PieceRowData {
  readonly id: string;
  readonly contentOwnerId: string;
  readonly ownerName: string;
  readonly title: string;
  readonly scriptMd: string | null;
  readonly category: MarketingCategory;
  readonly format: MarketingFormat;
  readonly platforms: readonly MarketingPlatform[];
  readonly scheduledRecordingAt: string | null;
  readonly scheduledPublishAt: string | null;
  readonly stage: MarketingStage;
  readonly recordingSessionId: string | null;
  readonly isDailyRecurring: boolean;
  readonly notes: string | null;
}

export function PlanificacionView({
  rows,
  ownerOptions,
  sessionOwnerOptions,
  personOptions,
  pieceOptions,
}: {
  readonly rows: readonly PieceRowData[];
  readonly ownerOptions: readonly OwnerOption[];
  readonly sessionOwnerOptions: readonly SessionOwnerOption[];
  readonly personOptions: readonly PersonOption[];
  readonly pieceOptions: readonly PieceOption[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [schedulingFromPiece, setSchedulingFromPiece] =
    useState<PieceRowData | null>(null);

  const editing =
    editingId != null ? rows.find((r) => r.id === editingId) ?? null : null;

  const editingInitial: PieceInitial | undefined =
    editing != null
      ? {
          id: editing.id,
          contentOwnerId: editing.contentOwnerId,
          title: editing.title,
          scriptMd: editing.scriptMd,
          category: editing.category,
          format: editing.format,
          platforms: editing.platforms,
          scheduledRecordingAt: editing.scheduledRecordingAt,
          scheduledPublishAt: editing.scheduledPublishAt,
          isDailyRecurring: editing.isDailyRecurring,
          notes: editing.notes,
          canHardDelete:
            (editing.stage === "planificado" ||
              editing.stage === "en_grabacion") &&
            editing.recordingSessionId == null,
        }
      : undefined;

  function handleStageChange(row: PieceRowData, next: MarketingStage) {
    setError(null);
    startTransition(async () => {
      const result = await setPieceStage(row.id, next);
      if ("error" in result) setError(result.error);
    });
  }

  const columns: Column<PieceRowData>[] = [
    {
      key: "title",
      label: "Título",
      render: (r) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ color: "var(--kg-text-1)", fontWeight: 600 }}>
            {r.title}
          </span>
          {r.isDailyRecurring && (
            <span
              className="kg-t7"
              style={{ color: "var(--kg-accent-text)" }}
            >
              Diaria · se regenera al publicar
            </span>
          )}
        </div>
      ),
    },
    {
      key: "owner",
      label: "Dueño",
      render: (r) => r.ownerName,
    },
    {
      key: "category",
      label: "Categoría",
      render: (r) => CATEGORY_LABEL[r.category],
    },
    {
      key: "format",
      label: "Formato",
      render: (r) => FORMAT_LABEL[r.format],
    },
    {
      key: "platforms",
      label: "Plataformas",
      render: (r) =>
        r.platforms.length === 0 ? (
          "—"
        ) : (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {r.platforms.map((p) => (
              <span
                key={p}
                style={{
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: "var(--kg-surface-2-solid)",
                  border: "1px solid var(--kg-border-subtle)",
                  fontSize: 11,
                  color: "var(--kg-text-2)",
                }}
              >
                {PLATFORM_LABEL[p]}
              </span>
            ))}
          </div>
        ),
    },
    {
      key: "recording",
      label: "Grabación",
      render: (r) =>
        r.scheduledRecordingAt ? formatDateTime(r.scheduledRecordingAt) : "—",
    },
    {
      key: "publish",
      label: "Publicación",
      render: (r) => (r.scheduledPublishAt ? formatDate(r.scheduledPublishAt) : "—"),
    },
    {
      key: "stage",
      label: "Estado",
      render: (r) => (
        <StatusPill text={STAGE_LABEL[r.stage]} tone={STAGE_TONE[r.stage]} />
      ),
    },
    {
      key: "actions",
      label: "",
      align: "right",
      render: (r) => {
        // "Programar grabación" — solo si la piece está lista para agendarse:
        // stage=planificado, sin sesión previa, y hay algún filmaker/experto
        // disponible en la org. El drawer arranca con owner+piece+fecha
        // pre-cargados; el usuario completa personas/ubicación/materiales.
        const canSchedule =
          (r.stage === "planificado" || r.stage === "en_grabacion") &&
          r.recordingSessionId == null;
        return (
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            {canSchedule && (
              <button
                type="button"
                onClick={() => setSchedulingFromPiece(r)}
                disabled={pending}
                className="kg-focus"
                style={{
                  ...rowBtn,
                  borderColor: "var(--kg-accent-500)",
                  color: "var(--kg-accent-text)",
                }}
                title="Programar grabación con esta pieza pre-seleccionada"
              >
                Programar grabación
              </button>
            )}
            <button
              type="button"
              onClick={() => setEditingId(r.id)}
              disabled={pending}
              className="kg-focus"
              style={rowBtn}
              title="Editar"
            >
              Editar
            </button>
            {r.stage === "descartado" ? (
              <button
                type="button"
                onClick={() => handleStageChange(r, "planificado")}
                disabled={pending}
                className="kg-focus"
                style={rowBtn}
                title="Restaurar a planificado"
              >
                Restaurar
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleStageChange(r, "descartado")}
                disabled={pending}
                className="kg-focus"
                style={rowBtn}
                title="Marcar como descartado (sale del pipeline sin borrar historial)"
              >
                Descartar
              </button>
            )}
          </div>
        );
      },
    },
  ];

  // Preset del drawer de grabación cuando venís desde "Programar grabación".
  // Fecha: la ya planificada en la piece si existe; si no, el drawer arranca
  // vacío y el usuario elige.
  const scheduleInitial: SessionInitial | undefined =
    schedulingFromPiece != null
      ? {
          contentOwnerId: schedulingFromPiece.contentOwnerId,
          scheduledAt: schedulingFromPiece.scheduledRecordingAt ?? undefined,
          pieceIds: [schedulingFromPiece.id],
        }
      : undefined;

  const noOwners = ownerOptions.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {error && (
        <div
          style={{
            margin: "12px 20px 0",
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

      <KgDataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        totalCount={rows.length}
        emptyTitle="Sin planificaciones que coincidan con el filtro"
        emptyHint={
          noOwners
            ? "Primero creá dueños en la pestaña Dueños."
            : "Cuando planificás un contenido, se lista acá y pasa a Grabación cuando lo asignás a una sesión."
        }
        fillHeight
      />

      <PieceFormDrawer
        mode="edit"
        open={editingId != null}
        onClose={() => setEditingId(null)}
        ownerOptions={ownerOptions}
        initial={editingInitial}
      />

      <SessionFormDrawer
        mode="create"
        open={schedulingFromPiece != null}
        onClose={() => setSchedulingFromPiece(null)}
        ownerOptions={sessionOwnerOptions}
        personOptions={personOptions}
        pieceOptions={pieceOptions}
        initial={scheduleInitial}
        initialKey={schedulingFromPiece?.id}
      />
    </div>
  );
}

/**
 * "2026-08-24T15:30:00Z" → "24/08 15:30". Formato local corto.
 */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * "2026-08-24" → "24/08". Sin new Date() para evitar shift por tz.
 */
function formatDate(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  if (!m || !d) return dateStr;
  return `${d}/${m}`;
}

const rowBtn: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
};
