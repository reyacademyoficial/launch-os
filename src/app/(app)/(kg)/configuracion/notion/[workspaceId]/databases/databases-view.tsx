"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import {
  setNotionDatabaseEnabled,
  syncNotionDatabase,
} from "../../actions";

export interface DatabaseRow {
  readonly id: string;
  readonly notionId: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly hasMapping: boolean;
  readonly updatedAt: string;
}

/**
 * Lista de databases descubiertas de un workspace. Por fila:
 *  - Toggle enabled (solo permitido si hay mapping configurado —
 *    activar sin mapping rebota en el sync).
 *  - Link "Configurar mapeo" al form.
 *  - Botón "Sincronizar ahora" para correr un sync manual solo de esta DB
 *    (útil para probar sin correr todas las DBs).
 */
export function DatabasesView({
  workspaceId,
  rows,
}: {
  readonly workspaceId: string;
  readonly rows: readonly DatabaseRow[];
}) {
  if (rows.length === 0) {
    return (
      <div
        className="kg-glass"
        style={{
          padding: 20,
          borderRadius: "var(--kg-r-12)",
          border: "1px dashed var(--kg-border-subtle)",
          color: "var(--kg-text-3)",
          fontSize: 13,
          textAlign: "center",
        }}
      >
        Todavía no descubrimos databases en este workspace. Volvé a la lista
        de workspaces y click "Descubrir DBs" en la card correspondiente.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map((r) => (
        <DatabaseCard key={r.id} row={r} workspaceId={workspaceId} />
      ))}
    </div>
  );
}

function DatabaseCard({
  row,
  workspaceId,
}: {
  readonly row: DatabaseRow;
  readonly workspaceId: string;
}) {
  const [pending, startAction] = useTransition();
  const [message, setMessage] = useState<
    { kind: "ok" | "error"; text: string } | null
  >(null);

  function handleToggle() {
    setMessage(null);
    if (!row.enabled && !row.hasMapping) {
      setMessage({
        kind: "error",
        text: "Configurá el mapeo antes de habilitar la database.",
      });
      return;
    }
    startAction(async () => {
      const res = await setNotionDatabaseEnabled(row.id, !row.enabled);
      if (!res.ok) setMessage({ kind: "error", text: res.error });
    });
  }

  function handleSyncOne() {
    setMessage(null);
    startAction(async () => {
      const res = await syncNotionDatabase(row.id);
      if (res.ok) {
        const skippedMsg =
          res.skippedNoTitle > 0
            ? ` (${res.skippedNoTitle} skipped por título vacío)`
            : "";
        const commentsMsg =
          res.commentsUpserted > 0
            ? ` · ${res.commentsUpserted} comentario(s)`
            : "";
        const failedMsg =
          res.commentsFailed > 0
            ? ` · ${res.commentsFailed} page(s) sin poder traer comentarios`
            : "";
        setMessage({
          kind: res.commentsFailed > 0 ? "error" : "ok",
          text: `Trajimos ${res.fetched} pages, upsertamos ${res.upserted}${skippedMsg}${commentsMsg}${failedMsg}.`,
        });
      } else {
        setMessage({ kind: "error", text: res.error });
      }
    });
  }

  return (
    <article
      className="kg-glass"
      style={{
        padding: 14,
        borderRadius: "var(--kg-r-12)",
        border: "1px solid var(--kg-border-subtle)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        opacity: row.enabled ? 1 : 0.7,
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              fontWeight: 700,
              color: "var(--kg-text-1)",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: row.enabled
                  ? "#00D084"
                  : "var(--kg-text-3)",
                display: "inline-block",
              }}
            />
            {row.name}
          </div>
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-3)", fontSize: 11 }}
          >
            {row.hasMapping ? "Mapeo configurado" : "Sin mapeo"} · Notion ID:{" "}
            <code style={{ fontSize: 10 }}>{row.notionId.slice(0, 8)}…</code>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 6,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <Link
            href={`/configuracion/notion/${workspaceId}/databases/${row.id}`}
            className="kg-focus"
            style={{ ...secondaryBtn, textDecoration: "none" }}
          >
            Configurar mapeo
          </Link>
          {row.enabled && row.hasMapping && (
            <button
              type="button"
              onClick={handleSyncOne}
              disabled={pending}
              className="kg-focus"
              style={secondaryBtn}
            >
              {pending ? "Sincronizando…" : "Sincronizar"}
            </button>
          )}
          <button
            type="button"
            onClick={handleToggle}
            disabled={pending || (!row.enabled && !row.hasMapping)}
            className="kg-focus"
            title={
              !row.enabled && !row.hasMapping
                ? "Configurá el mapeo antes de habilitar"
                : ""
            }
            style={secondaryBtn}
          >
            {row.enabled ? "Deshabilitar" : "Habilitar"}
          </button>
        </div>
      </header>

      {message && (
        <div
          style={{
            padding: "8px 10px",
            borderRadius: "var(--kg-r-8)",
            background:
              message.kind === "ok"
                ? "rgba(0,208,132,0.10)"
                : "rgba(239,68,68,0.10)",
            border: `1px solid ${message.kind === "ok" ? "#00D084" : "#EF4444"}`,
            color: message.kind === "ok" ? "#00D084" : "#EF4444",
            fontSize: 12,
            lineHeight: 1.4,
          }}
        >
          {message.text}
        </div>
      )}
    </article>
  );
}

const secondaryBtn: React.CSSProperties = {
  padding: "5px 12px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
};
