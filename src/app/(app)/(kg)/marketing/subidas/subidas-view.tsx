"use client";

import { useMemo, useState, useTransition } from "react";

import { KgCalendar, type KgCalendarEvent } from "@/components/kg/calendar";
import { KgDataTable, type Column } from "@/components/kg/data-table";
import { Drawer } from "@/components/kg/drawer";
import { StatusPill } from "@/components/kg/status-pill";
import {
  FORMAT_LABEL,
  PLATFORM_LABEL,
  UPLOAD_STATUS_LABEL,
  UPLOAD_STATUS_TONE,
  UPLOAD_STATUSES,
  type MarketingFormat,
  type MarketingPlatform,
  type UploadStatus,
} from "@/lib/marketing/types";

import { markUploaded, setUploadStatus } from "./actions";
import {
  UploadFormDrawer,
  type AssetOption,
  type CadenceLite,
  type OwnerOption,
  type UploadInitial,
} from "./upload-form-drawer";

// ═══════════════════════════════════════════════════════════════════════════
// Vista dual tabla ⇄ calendario para content_uploads.
//
// Mismo patrón que grabación: `?view=` controla qué renderizamos; el
// popover del día en el calendario abre un Drawer con la lista.
// ═══════════════════════════════════════════════════════════════════════════

export interface UploadRowData {
  readonly id: string;
  readonly contentAssetId: string;
  readonly contentOwnerId: string; // resolvido del asset
  readonly ownerName: string;
  readonly assetName: string;
  readonly assetFormat: MarketingFormat;
  readonly platform: MarketingPlatform;
  readonly scheduledFor: string; // yyyy-mm-dd
  readonly uploadedAt: string | null;
  readonly status: UploadStatus;
  readonly publicUrl: string | null;
  readonly notes: string | null;
}

export function SubidasView({
  view,
  rows,
  year,
  month,
  baseHref,
  preserveParams,
  ownerOptions,
  assetOptions,
  cadences,
}: {
  readonly view: "tabla" | "calendario";
  readonly rows: readonly UploadRowData[];
  readonly year: number;
  readonly month: number;
  readonly baseHref: string;
  readonly preserveParams?: Record<string, string | null>;
  readonly ownerOptions: readonly OwnerOption[];
  readonly assetOptions: readonly AssetOption[];
  readonly cadences: readonly CadenceLite[];
}) {
  const [creating, setCreating] = useState<
    { open: true; presetDate?: string } | { open: false }
  >({ open: false });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dayDrawerKey, setDayDrawerKey] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const noAssets = assetOptions.length === 0;

  const editing =
    editingId != null ? rows.find((r) => r.id === editingId) ?? null : null;

  const editingInitial: UploadInitial | undefined =
    editing != null
      ? {
          id: editing.id,
          contentAssetId: editing.contentAssetId,
          contentOwnerId: editing.contentOwnerId,
          platform: editing.platform,
          scheduledFor: editing.scheduledFor,
          status: editing.status,
          publicUrl: editing.publicUrl,
          notes: editing.notes,
        }
      : undefined;

  const marking =
    markingId != null ? rows.find((r) => r.id === markingId) ?? null : null;

  const eventsByDate = useMemo(() => {
    const map = new Map<string, KgCalendarEvent[]>();
    for (const r of rows) {
      const key = r.scheduledFor;
      const arr = map.get(key) ?? [];
      arr.push({
        id: r.id,
        label: `${PLATFORM_LABEL[r.platform]} · ${r.assetName}`,
        tone: UPLOAD_STATUS_TONE[r.status],
      });
      map.set(key, arr);
    }
    for (const [k, arr] of map) {
      arr.sort((a, b) => a.label.localeCompare(b.label));
      map.set(k, arr);
    }
    return map;
  }, [rows]);

  const rowsOfDay = useMemo(() => {
    if (dayDrawerKey == null) return [];
    return rows
      .filter((r) => r.scheduledFor === dayDrawerKey)
      .sort((a, b) => a.platform.localeCompare(b.platform));
  }, [dayDrawerKey, rows]);

  function handleStatusChange(row: UploadRowData, next: UploadStatus) {
    setError(null);
    startTransition(async () => {
      const result = await setUploadStatus(row.id, next);
      if ("error" in result) setError(result.error);
    });
  }

  const columns: Column<UploadRowData>[] = [
    {
      key: "scheduled_for",
      label: "Fecha",
      render: (r) => (
        <span
          style={{
            color: "var(--kg-text-1)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatDay(r.scheduledFor)}
        </span>
      ),
    },
    {
      key: "platform",
      label: "Plataforma",
      render: (r) => PLATFORM_LABEL[r.platform],
    },
    {
      key: "asset",
      label: "Asset",
      render: (r) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ color: "var(--kg-text-1)", fontWeight: 600 }}>
            {r.assetName}
          </span>
          <span className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
            {FORMAT_LABEL[r.assetFormat]} · {r.ownerName}
          </span>
        </div>
      ),
    },
    {
      key: "uploaded_at",
      label: "Subida",
      render: (r) =>
        r.uploadedAt ? (
          <span
            style={{
              fontVariantNumeric: "tabular-nums",
              color: "var(--kg-text-2)",
            }}
          >
            {formatDateTime(r.uploadedAt)}
          </span>
        ) : (
          <span style={{ color: "var(--kg-text-3)" }}>—</span>
        ),
    },
    {
      key: "status",
      label: "Estado",
      render: (r) => (
        <StatusPill
          text={UPLOAD_STATUS_LABEL[r.status]}
          tone={UPLOAD_STATUS_TONE[r.status]}
        />
      ),
    },
    {
      key: "link",
      label: "",
      render: (r) =>
        r.publicUrl ? (
          <a
            href={r.publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "var(--kg-accent-text)",
              textDecoration: "none",
              fontSize: 11,
            }}
          >
            Ver ↗
          </a>
        ) : (
          <span style={{ color: "var(--kg-text-3)" }}>—</span>
        ),
    },
    {
      key: "actions",
      label: "",
      align: "right",
      render: (r) => (
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          {r.status !== "subida" && r.status !== "cancelada" && (
            <button
              type="button"
              onClick={() => setMarkingId(r.id)}
              disabled={pending}
              className="kg-focus"
              style={rowBtn}
              title="Marcar como subido y opcionalmente pegar el link"
            >
              Marcar subida
            </button>
          )}
          <button
            type="button"
            onClick={() => setEditingId(r.id)}
            disabled={pending}
            className="kg-focus"
            style={rowBtn}
          >
            Editar
          </button>
          <StatusMenu
            current={r.status}
            onSelect={(next) => handleStatusChange(r, next)}
            disabled={pending}
          />
        </div>
      ),
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {error && (
        <div style={{ ...errorStyle, margin: "12px 20px 0" }}>{error}</div>
      )}

      {view === "tabla" ? (
        <KgDataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          totalCount={rows.length}
          emptyTitle="Sin subidas registradas"
          emptyHint={
            noAssets
              ? "Primero registrá assets en la pestaña Edición."
              : "Programá subidas para ver la agenda por plataforma y fecha."
          }
          fillHeight
        />
      ) : (
        <KgCalendar
          year={year}
          month={month}
          baseHref={baseHref}
          preserveParams={preserveParams}
          eventsByDate={eventsByDate}
          onDaySelect={(k) => setDayDrawerKey(k)}
          trailingAction={
            <button
              type="button"
              onClick={() => setCreating({ open: true })}
              disabled={noAssets}
              className="kg-focus"
              style={{ ...primaryBtn, opacity: noAssets ? 0.5 : 1 }}
            >
              + Nueva subida
            </button>
          }
        />
      )}

      <UploadFormDrawer
        mode="create"
        open={creating.open}
        onClose={() => setCreating({ open: false })}
        ownerOptions={ownerOptions}
        assetOptions={assetOptions}
        cadences={cadences}
        presetDate={creating.open ? creating.presetDate : undefined}
      />

      <UploadFormDrawer
        mode="edit"
        open={editingId != null}
        onClose={() => setEditingId(null)}
        ownerOptions={ownerOptions}
        assetOptions={assetOptions}
        cadences={cadences}
        initial={editingInitial}
      />

      <MarkUploadedDrawer
        open={marking != null}
        row={marking ?? null}
        onClose={() => setMarkingId(null)}
      />

      <Drawer
        open={dayDrawerKey != null}
        onClose={() => setDayDrawerKey(null)}
        title={
          dayDrawerKey != null ? `Subidas del ${formatDay(dayDrawerKey)}` : ""
        }
        width={480}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {rowsOfDay.length === 0 ? (
            <div
              className="kg-t7"
              style={{
                padding: "12px 14px",
                borderRadius: "var(--kg-r-8)",
                background: "var(--kg-surface-2-solid)",
                border: "1px dashed var(--kg-border-subtle)",
                color: "var(--kg-text-3)",
                textAlign: "center",
              }}
            >
              Ninguna subida programada este día.
            </div>
          ) : (
            rowsOfDay.map((r) => (
              <div
                key={r.id}
                style={{
                  padding: "10px 14px",
                  borderRadius: "var(--kg-r-8)",
                  background: "var(--kg-surface-2-solid)",
                  border: "1px solid var(--kg-border-subtle)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <div
                    className="kg-t6"
                    style={{ color: "var(--kg-text-1)", fontWeight: 600 }}
                  >
                    {PLATFORM_LABEL[r.platform]} · {r.assetName}
                  </div>
                  <StatusPill
                    text={UPLOAD_STATUS_LABEL[r.status]}
                    tone={UPLOAD_STATUS_TONE[r.status]}
                  />
                </div>
                <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
                  {r.ownerName} · {FORMAT_LABEL[r.assetFormat]}
                </div>
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  {r.status !== "subida" && r.status !== "cancelada" && (
                    <button
                      type="button"
                      onClick={() => {
                        setDayDrawerKey(null);
                        setMarkingId(r.id);
                      }}
                      className="kg-focus"
                      style={rowBtn}
                    >
                      Marcar subida
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setDayDrawerKey(null);
                      setEditingId(r.id);
                    }}
                    className="kg-focus"
                    style={rowBtn}
                  >
                    Editar
                  </button>
                </div>
              </div>
            ))
          )}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => {
                const preset = dayDrawerKey ?? undefined;
                setDayDrawerKey(null);
                setCreating({ open: true, presetDate: preset });
              }}
              disabled={noAssets}
              className="kg-focus"
              style={{ ...primaryBtn, opacity: noAssets ? 0.5 : 1 }}
            >
              + Nueva subida este día
            </button>
          </div>
        </div>
      </Drawer>
    </div>
  );
}

function MarkUploadedDrawer({
  open,
  row,
  onClose,
}: {
  readonly open: boolean;
  readonly row: UploadRowData | null;
  readonly onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");

  if (!open || !row) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!row) return;
    setError(null);
    startTransition(async () => {
      const result = await markUploaded(row.id, url);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setUrl("");
      onClose();
    });
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Marcar como subido"
      subtitle={`${PLATFORM_LABEL[row.platform]} · ${row.assetName}`}
      width={480}
    >
      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: 16 }}
      >
        <div>
          <label
            htmlFor="mark_public_url"
            className="kg-t7"
            style={{
              display: "block",
              color: "var(--kg-text-3)",
              marginBottom: 6,
            }}
          >
            Link al posteo (opcional)
          </label>
          <input
            id="mark_public_url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.instagram.com/reel/..."
            style={{
              width: "100%",
              padding: "9px 12px",
              borderRadius: "var(--kg-r-8)",
              background: "var(--kg-surface-2-solid)",
              border: "1px solid var(--kg-border-subtle)",
              color: "var(--kg-text-1)",
              fontSize: 13,
              colorScheme: "dark",
            }}
          />
        </div>

        <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
          Al marcar como subida, el piece origen (si existe) pasa a
          &quot;Publicado&quot; automáticamente. Si tenía la marca de tarea
          diaria, se regenera el hermano del día siguiente.
        </div>

        {error && <div style={errorStyle}>{error}</div>}

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
            {pending ? "Marcando…" : "Marcar como subida"}
          </button>
        </div>
      </form>
    </Drawer>
  );
}

function StatusMenu({
  current,
  onSelect,
  disabled,
}: {
  readonly current: UploadStatus;
  readonly onSelect: (next: UploadStatus) => void;
  readonly disabled: boolean;
}) {
  return (
    <select
      value={current}
      onChange={(e) => onSelect(e.target.value as UploadStatus)}
      disabled={disabled}
      aria-label="Cambiar estado"
      style={{
        padding: "4px 10px",
        borderRadius: 999,
        background: "transparent",
        border: "1px solid var(--kg-border-subtle)",
        color: "var(--kg-text-2)",
        fontSize: 11,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        colorScheme: "dark",
      }}
    >
      {UPLOAD_STATUSES.map((s) => (
        <option key={s} value={s}>
          {UPLOAD_STATUS_LABEL[s]}
        </option>
      ))}
    </select>
  );
}

function formatDay(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d}/${m}/${y}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

const errorStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: "var(--kg-r-8)",
  background: "rgba(239,68,68,0.10)",
  border: "1px solid #EF4444",
  color: "#EF4444",
  fontSize: 12,
};
