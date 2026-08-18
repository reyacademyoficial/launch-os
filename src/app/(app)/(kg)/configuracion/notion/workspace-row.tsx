"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import {
  deleteNotionWorkspace,
  discoverNotionDatabases,
  setNotionWorkspaceEnabled,
} from "./actions";

interface WorkspaceRowData {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly lastVerifiedAt: string | null;
  readonly lastVerifyOk: boolean | null;
  readonly databasesCount: number;
  readonly databasesEnabledCount: number;
}

/**
 * Card por workspace conectado. Acciones directas:
 *   - Toggle enabled (pausa el sync sin borrar el workspace)
 *   - Descubrir DBs (llama a Notion → upsertea notion_databases)
 *   - Eliminar (con confirmación — cascade elimina databases, users,
 *     sync_log; los internal_projects sincronizados NO se borran)
 *
 * La UI de configurar mapeo por database + habilitar/deshabilitar cada DB
 * la agregamos en 4c cuando armemos el flujo de sync de projects. Por
 * ahora solo se descubren.
 */
export function WorkspaceRow({
  workspace,
}: {
  readonly workspace: WorkspaceRowData;
}) {
  const [pending, startAction] = useTransition();
  const [message, setMessage] = useState<
    { kind: "ok" | "error"; text: string } | null
  >(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function handleToggle() {
    setMessage(null);
    startAction(async () => {
      const res = await setNotionWorkspaceEnabled(
        workspace.id,
        !workspace.enabled,
      );
      if (res && "error" in res && res.error) {
        setMessage({ kind: "error", text: res.error });
      }
    });
  }

  function handleDiscover() {
    setMessage(null);
    startAction(async () => {
      const res = await discoverNotionDatabases(workspace.id);
      if (res.ok) {
        setMessage({
          kind: "ok",
          text:
            res.discovered > 0
              ? `${res.discovered} database(s) nueva(s) descubierta(s). Total: ${res.total}.`
              : `Sin novedades. Total accesible: ${res.total} database(s).`,
        });
      } else {
        setMessage({ kind: "error", text: res.error });
      }
    });
  }

  function handleDelete() {
    setMessage(null);
    startAction(async () => {
      const res = await deleteNotionWorkspace(workspace.id);
      if (res && "error" in res && res.error) {
        setMessage({ kind: "error", text: res.error });
        setConfirmDelete(false);
      }
    });
  }

  const verifyLabel = workspace.lastVerifiedAt
    ? `Última verificación: ${fmtRelative(workspace.lastVerifiedAt)}${
        workspace.lastVerifyOk === false ? " · falló" : ""
      }`
    : "Sin verificar";

  return (
    <article
      className="kg-glass"
      style={{
        padding: 16,
        borderRadius: "var(--kg-r-12)",
        border: "1px solid var(--kg-border-subtle)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        opacity: workspace.enabled ? 1 : 0.65,
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
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
              fontSize: 14,
              fontWeight: 700,
              color: "var(--kg-text-1)",
            }}
          >
            <StateDot ok={workspace.enabled} />
            {workspace.name}
          </div>
          <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
            {verifyLabel} · {workspace.databasesEnabledCount}/
            {workspace.databasesCount} database
            {workspace.databasesCount === 1 ? "" : "s"} activa
            {workspace.databasesEnabledCount === 1 ? "" : "s"}
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
            href={`/configuracion/notion/${workspace.id}/usuarios`}
            className="kg-focus"
            style={{ ...secondaryBtn, textDecoration: "none" }}
          >
            Usuarios
          </Link>
          <Link
            href={`/configuracion/notion/${workspace.id}/databases`}
            className="kg-focus"
            style={{ ...secondaryBtn, textDecoration: "none" }}
          >
            Databases
          </Link>
          <button
            type="button"
            onClick={handleDiscover}
            disabled={pending}
            className="kg-focus"
            title="Refrescar la lista de databases visibles para esta integration"
            style={secondaryBtn}
          >
            Descubrir DBs
          </button>
          <button
            type="button"
            onClick={handleToggle}
            disabled={pending}
            className="kg-focus"
            style={secondaryBtn}
          >
            {workspace.enabled ? "Pausar" : "Reactivar"}
          </button>
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              disabled={pending}
              className="kg-focus"
              style={{ ...secondaryBtn, color: "#EF4444" }}
            >
              Eliminar
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={pending}
                className="kg-focus"
                style={secondaryBtn}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={pending}
                className="kg-focus"
                style={{
                  ...secondaryBtn,
                  background: "#EF4444",
                  color: "#fff",
                  border: "none",
                }}
              >
                {pending ? "Eliminando…" : "Confirmar eliminar"}
              </button>
            </>
          )}
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

// ═══════════════════════════════════════════════════════════════════════════
// Helpers de UI
// ═══════════════════════════════════════════════════════════════════════════

function StateDot({ ok }: { readonly ok: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        width: 8,
        height: 8,
        borderRadius: 999,
        background: ok ? "#00D084" : "var(--kg-text-3)",
        display: "inline-block",
      }}
    />
  );
}

/**
 * Formato relativo compacto: "hace 3 min", "hace 2 h", "hace 5 d". Para
 * timestamps más viejos cae al ISO short.
 */
function fmtRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 60) return "hace un instante";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `hace ${diffHr} h`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `hace ${diffDay} d`;
  return iso.slice(0, 10);
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
