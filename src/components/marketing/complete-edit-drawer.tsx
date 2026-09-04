"use client";

import { useState, useTransition } from "react";

import { Drawer } from "@/components/kg/drawer";
import {
  ErrorBanner,
  Field,
  inputStyle,
  primaryBtn,
  secondaryBtn,
  smallBtn,
} from "@/components/kg/form-primitives";
import {
  completeContentEdit,
  type CompleteEditRow,
} from "@/app/(app)/(kg)/marketing/edicion/actions";
import {
  FORMAT_LABEL,
  MARKETING_FORMATS,
  type MarketingFormat,
} from "@/lib/marketing/types";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer "Marcar como realizada" — cierra un content_edit cargando los N
// archivos que salieron de esa edición. Reemplaza a ProductionBatchDrawer:
// antes esto se abría desde una sesión de grabación y creaba directo el
// archivo "editado"; ahora se abre desde un evento de edición ya en curso y
// cierra ese evento en el mismo acto.
//
// Cada fila puede opcionalmente asociarse a una content_piece — a diferencia
// del batch viejo (que nunca lo hacía), esto es lo que permite que una piece
// llegue a `listo_para_subir` por este camino.
// ═══════════════════════════════════════════════════════════════════════════

export interface EditContextForComplete {
  readonly id: string;
  readonly contentOwnerId: string;
  readonly title: string;
  readonly rawLabel: string | null;
}

export interface PieceOptionForComplete {
  readonly id: string;
  readonly contentOwnerId: string;
  readonly title: string;
}

export function CompleteEditDrawer({
  open,
  onClose,
  edit,
  pieceOptions,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly edit: EditContextForComplete | null;
  readonly pieceOptions: readonly PieceOptionForComplete[];
}) {
  if (!open || !edit) return null;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Marcar como realizada"
      subtitle={`Cargá los archivos que salieron de "${edit.title}"${
        edit.rawLabel ? ` (crudo: ${edit.rawLabel})` : ""
      }. Entran directo al stock disponible para subir.`}
      width={720}
    >
      <CompleteBody
        key={edit.id}
        onClose={onClose}
        edit={edit}
        pieceOptions={pieceOptions}
      />
    </Drawer>
  );
}

interface DraftRow {
  readonly key: string;
  readonly name: string;
  readonly format: MarketingFormat;
  readonly durationSeconds: string;
  readonly driveAssetUrl: string;
  readonly sourceContentPieceId: string;
}

function newRow(index: number): DraftRow {
  return {
    key: `row-${Date.now()}-${index}`,
    name: "",
    format: "reel",
    durationSeconds: "",
    driveAssetUrl: "",
    sourceContentPieceId: "",
  };
}

function CompleteBody({
  onClose,
  edit,
  pieceOptions,
}: {
  readonly onClose: () => void;
  readonly edit: EditContextForComplete;
  readonly pieceOptions: readonly PieceOptionForComplete[];
}) {
  const [completedAt, setCompletedAt] = useState<string>(defaultNowLocal());
  const [rows, setRows] = useState<DraftRow[]>(() => [newRow(0)]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const availablePieces = pieceOptions.filter(
    (p) => p.contentOwnerId === edit.contentOwnerId,
  );

  function addRow() {
    setRows((prev) => [...prev, newRow(prev.length)]);
  }

  function removeRow(key: string) {
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((r) => r.key !== key)));
  }

  function updateRow(key: string, patch: Partial<DraftRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      if (!r.name.trim()) {
        setError(`Fila ${i + 1}: el nombre es obligatorio.`);
        return;
      }
      if (r.durationSeconds.trim().length > 0) {
        const n = Number.parseInt(r.durationSeconds, 10);
        if (!Number.isFinite(n) || n <= 0) {
          setError(`Fila ${i + 1}: la duración debe ser un entero positivo.`);
          return;
        }
      }
    }

    const payloadRows: CompleteEditRow[] = rows.map((r) => ({
      name: r.name.trim(),
      format: r.format,
      durationSeconds:
        r.durationSeconds.trim().length === 0
          ? null
          : Number.parseInt(r.durationSeconds, 10),
      driveAssetUrl:
        r.driveAssetUrl.trim().length === 0 ? null : r.driveAssetUrl.trim(),
      sourceContentPieceId:
        r.sourceContentPieceId.trim().length === 0 ? null : r.sourceContentPieceId,
    }));

    startTransition(async () => {
      const result = await completeContentEdit({
        contentEditId: edit.id,
        completedAt: completedAt ? fromDatetimeLocal(completedAt) : null,
        rows: payloadRows,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      onClose();
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <Field
        label="Fecha de edición"
        htmlFor="complete_completed_at"
        hint="Por defecto ahora — cambiala si estás cargando esto días después."
      >
        <input
          id="complete_completed_at"
          type="datetime-local"
          value={completedAt}
          onChange={(e) => setCompletedAt(e.target.value)}
          style={inputStyle}
        />
      </Field>

      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 6,
          }}
        >
          <span className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
            Archivos editados ({rows.length})
          </span>
          <button
            type="button"
            onClick={addRow}
            className="kg-focus"
            style={smallBtn}
          >
            + Agregar archivo
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((r, idx) => (
            <div
              key={r.key}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: "10px 12px",
                borderRadius: "var(--kg-r-8)",
                background: "var(--kg-surface-2-solid)",
                border: "1px solid var(--kg-border-subtle)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span
                  className="kg-t7"
                  style={{ color: "var(--kg-text-3)", fontWeight: 700 }}
                >
                  #{idx + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removeRow(r.key)}
                  disabled={rows.length === 1}
                  className="kg-focus"
                  style={{
                    ...smallBtn,
                    borderColor: rows.length === 1 ? undefined : "#EF4444",
                    color: rows.length === 1 ? undefined : "#EF4444",
                    opacity: rows.length === 1 ? 0.4 : 1,
                  }}
                  title={
                    rows.length === 1
                      ? "Al menos un archivo por edición"
                      : "Quitar este archivo"
                  }
                >
                  ×
                </button>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 2 }}>
                  <input
                    type="text"
                    value={r.name}
                    onChange={(e) => updateRow(r.key, { name: e.target.value })}
                    required
                    maxLength={200}
                    placeholder="Nombre del archivo (como está en la carpeta)"
                    aria-label={`Fila ${idx + 1}: nombre del archivo`}
                    style={inputStyle}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <select
                    value={r.format}
                    onChange={(e) =>
                      updateRow(r.key, { format: e.target.value as MarketingFormat })
                    }
                    aria-label={`Fila ${idx + 1}: formato`}
                    style={inputStyle}
                  >
                    {MARKETING_FORMATS.map((f) => (
                      <option key={f} value={f}>
                        {FORMAT_LABEL[f]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 2 }}>
                  <select
                    value={r.sourceContentPieceId}
                    onChange={(e) =>
                      updateRow(r.key, { sourceContentPieceId: e.target.value })
                    }
                    aria-label={`Fila ${idx + 1}: piece origen`}
                    style={inputStyle}
                  >
                    <option value="">Piece origen (opcional)</option>
                    {availablePieces.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <input
                    type="number"
                    min={1}
                    value={r.durationSeconds}
                    onChange={(e) =>
                      updateRow(r.key, { durationSeconds: e.target.value })
                    }
                    placeholder="Segs"
                    aria-label={`Fila ${idx + 1}: duración en segundos`}
                    style={inputStyle}
                  />
                </div>
              </div>

              <input
                type="url"
                value={r.driveAssetUrl}
                onChange={(e) => updateRow(r.key, { driveAssetUrl: e.target.value })}
                placeholder="Link directo al archivo (opcional)"
                aria-label={`Fila ${idx + 1}: link al archivo`}
                style={inputStyle}
              />
            </div>
          ))}
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

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
          type="submit"
          disabled={pending}
          className="kg-focus"
          style={{ ...primaryBtn, opacity: pending ? 0.7 : 1 }}
        >
          {pending
            ? "Guardando…"
            : `Marcar realizada — ${rows.length} archivo${rows.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </form>
  );
}

function defaultNowLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocal(value: string): string | null {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
