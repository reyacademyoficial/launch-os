"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

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
  createProductionBatch,
  type ProductionBatchRow,
} from "@/app/(app)/(kg)/marketing/edicion/actions";
import {
  FORMAT_LABEL,
  MARKETING_FORMATS,
  type MarketingFormat,
} from "@/lib/marketing/types";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer "Registrar producción" — bulk create de content_assets desde una
// sesión de grabación. Filas dinámicas para los N cortes que salieron.
//
// Se abre desde dos puntos:
//   - /marketing/grabacion (fila de sesión 'realizada') — con sesión
//     pre-seleccionada y locked (no se puede cambiar).
//   - /marketing/edicion (botón + Registrar producción) — con dropdown de
//     sesiones disponibles (todas las 'realizada' del último año).
//
// Cada fila = un asset: nombre (obligatorio, el del archivo en Drive),
// formato, editor opcional, duración opcional, link directo opcional.
// El drive_folder_url arriba se propaga a los N assets — típicamente 1
// carpeta compartida por sesión.
//
// Por default `edited_at = now()` en el submit (todos los assets se
// consideran recién editados). El input datetime permite backdatear si el
// batch se registra días después.
// ═══════════════════════════════════════════════════════════════════════════

export interface SessionOptionForBatch {
  readonly id: string;
  readonly contentOwnerId: string;
  readonly ownerName: string;
  readonly scheduledAt: string; // ISO
  readonly status: string;
}

export interface PersonOptionForBatch {
  readonly id: string;
  readonly fullName: string;
}

export function ProductionBatchDrawer({
  open,
  onClose,
  sessionOptions,
  personOptions,
  presetSessionId,
  initialKey,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Sesiones elegibles (típicamente `status='realizada'`). */
  readonly sessionOptions: readonly SessionOptionForBatch[];
  readonly personOptions: readonly PersonOptionForBatch[];
  /** Si viene, el picker de sesión queda bloqueado en ese id. */
  readonly presetSessionId?: string;
  /**
   * Cambiar este valor entre aperturas fuerza remount — usar cuando el mismo
   * drawer se abre con otro `presetSessionId`.
   */
  readonly initialKey?: string;
}) {
  if (!open) return null;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Registrar producción"
      subtitle="Cargá los cortes que salieron de esta grabación. Entran a la cola de edición; pasan al stock cuando el editor los marca terminados."
      width={720}
    >
      <BatchBody
        key={initialKey ?? presetSessionId ?? "batch"}
        onClose={onClose}
        sessionOptions={sessionOptions}
        personOptions={personOptions}
        presetSessionId={presetSessionId}
      />
    </Drawer>
  );
}

interface DraftRow {
  readonly key: string;
  readonly name: string;
  readonly format: MarketingFormat;
  readonly editorPersonId: string;
  readonly durationSeconds: string; // string en UI, se parsea al submit
  readonly driveAssetUrl: string;
}

function newRow(index: number): DraftRow {
  return {
    key: `row-${Date.now()}-${index}`,
    name: "",
    format: "reel",
    editorPersonId: "",
    durationSeconds: "",
    driveAssetUrl: "",
  };
}

function BatchBody({
  onClose,
  sessionOptions,
  personOptions,
  presetSessionId,
}: {
  readonly onClose: () => void;
  readonly sessionOptions: readonly SessionOptionForBatch[];
  readonly personOptions: readonly PersonOptionForBatch[];
  readonly presetSessionId?: string;
}) {
  const [sessionId, setSessionId] = useState<string>(presetSessionId ?? "");
  const [driveFolderUrl, setDriveFolderUrl] = useState<string>("");
  const [editDueDate, setEditDueDate] = useState<string>(defaultDueDate());
  const [rows, setRows] = useState<DraftRow[]>(() => [newRow(0)]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Sesión seleccionada — resuelve owner que va al server. Locked si vino
  // preset (no se puede cambiar sin cerrar el drawer).
  const selectedSession = useMemo(
    () => sessionOptions.find((s) => s.id === sessionId) ?? null,
    [sessionId, sessionOptions],
  );

  useEffect(() => {
    if (presetSessionId && sessionId !== presetSessionId) {
      setSessionId(presetSessionId);
    }
  }, [presetSessionId, sessionId]);

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

    if (!selectedSession) {
      setError("Elegí una sesión de grabación.");
      return;
    }

    // Validación local antes de mandar — mismos guards que la action pero
    // con feedback inmediato.
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

    const payloadRows: ProductionBatchRow[] = rows.map((r) => ({
      name: r.name.trim(),
      format: r.format,
      editorPersonId: r.editorPersonId.trim().length === 0 ? null : r.editorPersonId,
      durationSeconds:
        r.durationSeconds.trim().length === 0
          ? null
          : Number.parseInt(r.durationSeconds, 10),
      driveAssetUrl:
        r.driveAssetUrl.trim().length === 0 ? null : r.driveAssetUrl.trim(),
    }));

    startTransition(async () => {
      const result = await createProductionBatch({
        sourceRecordingSessionId: selectedSession.id,
        contentOwnerId: selectedSession.contentOwnerId,
        driveFolderUrl:
          driveFolderUrl.trim().length === 0 ? null : driveFolderUrl.trim(),
        editDueDate: editDueDate.trim().length === 0 ? null : editDueDate.trim(),
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
      <Field label="Sesión de grabación" htmlFor="batch_session_id" required>
        <select
          id="batch_session_id"
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          required
          disabled={presetSessionId != null}
          style={{ ...inputStyle, opacity: presetSessionId != null ? 0.75 : 1 }}
        >
          <option value="">— Elegí una sesión realizada —</option>
          {sessionOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {formatSessionLabel(s)}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Carpeta de Drive (compartida)" htmlFor="batch_folder">
        <input
          id="batch_folder"
          type="url"
          value={driveFolderUrl}
          onChange={(e) => setDriveFolderUrl(e.target.value)}
          placeholder="https://drive.google.com/drive/folders/..."
          style={inputStyle}
        />
      </Field>

      <Field
        label="Editado para (fecha objetivo)"
        htmlFor="batch_edit_due_date"
        hint="Los cortes entran a la cola de edición con esta fecha. Es lo que ordena el planning semanal de cada editor."
      >
        <input
          id="batch_edit_due_date"
          type="date"
          value={editDueDate}
          onChange={(e) => setEditDueDate(e.target.value)}
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
            Cortes producidos ({rows.length})
          </span>
          <button
            type="button"
            onClick={addRow}
            className="kg-focus"
            style={smallBtn}
          >
            + Agregar corte
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
                      ? "Al menos un corte por batch"
                      : "Quitar este corte"
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
                    aria-label={`Fila ${idx + 1}: nombre del asset`}
                    style={inputStyle}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <select
                    value={r.format}
                    onChange={(e) =>
                      updateRow(r.key, {
                        format: e.target.value as MarketingFormat,
                      })
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
                    value={r.editorPersonId}
                    onChange={(e) =>
                      updateRow(r.key, { editorPersonId: e.target.value })
                    }
                    aria-label={`Fila ${idx + 1}: editor`}
                    style={inputStyle}
                  >
                    <option value="">Editor (opcional)</option>
                    {personOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.fullName}
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
                onChange={(e) =>
                  updateRow(r.key, { driveAssetUrl: e.target.value })
                }
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
          {pending ? "Guardando…" : `Registrar ${rows.length} corte${rows.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </form>
  );
}

function formatSessionLabel(s: SessionOptionForBatch): string {
  const d = new Date(s.scheduledAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = Number.isNaN(d.getTime())
    ? s.scheduledAt
    : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  return `${date} · ${s.ownerName}`;
}

/**
 * Default de la fecha objetivo de edición: el viernes de esta semana (o el
 * de la semana que viene si hoy ya es sábado o domingo). La producción de
 * la semana se edita antes del fin de semana — es el default que menos
 * corrige el usuario. Siempre editable en el input.
 */
function defaultDueDate(): string {
  const d = new Date();
  const daysToFriday = (5 - d.getDay() + 7) % 7; // getDay: 0=domingo … 6=sábado
  d.setDate(d.getDate() + daysToFriday);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
