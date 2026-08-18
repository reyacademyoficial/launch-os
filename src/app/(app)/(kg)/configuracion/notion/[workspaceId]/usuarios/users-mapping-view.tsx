"use client";

import { useState, useTransition } from "react";

import {
  autoMatchNotionUsers,
  setNotionUserPersonMapping,
  syncNotionUsers,
} from "../../actions";

export interface NotionUserRow {
  readonly notionUserId: string;
  readonly email: string | null;
  readonly name: string | null;
  readonly avatarUrl: string | null;
  readonly kgPersonId: string | null;
}

export interface OrgPersonOption {
  readonly id: string;
  readonly fullName: string;
  readonly email: string | null;
  readonly active: boolean;
}

/**
 * Tabla de usuarios de Notion + dropdown de mapeo a `organization_people`.
 *
 * ACCIONES
 *   - "Sincronizar ahora" → refetch de Notion API + upsert. También corre
 *     auto-match para users nuevos (los ya mapeados manualmente NO se pisan).
 *   - "Auto-matchear por email" → NO refetch, solo re-corre el matching
 *     sobre users sin mapear (útil si cambiaste emails en Personas después
 *     del último sync).
 *   - Cambiar el dropdown de una fila → save inline con setNotionUserPersonMapping.
 *
 * OPTIMISTIC UI
 *   El dropdown actualiza el state local antes de que responda el server.
 *   Si el server falla, revertimos y mostramos el error abajo. Los cambios
 *   optimistas evitan que el usuario espere el round-trip para cada cambio.
 */
export function UsersMappingView({
  workspaceId,
  rows,
  people,
}: {
  readonly workspaceId: string;
  readonly rows: readonly NotionUserRow[];
  readonly people: readonly OrgPersonOption[];
}) {
  const [pendingSync, startSync] = useTransition();
  const [pendingMatch, startMatch] = useTransition();
  const [message, setMessage] = useState<
    { kind: "ok" | "error"; text: string } | null
  >(null);

  // Estado local con override — permite optimistic updates sin refetch.
  const [overrides, setOverrides] = useState<Map<string, string | null>>(
    () => new Map(),
  );

  function currentMapping(row: NotionUserRow): string | null {
    return overrides.has(row.notionUserId)
      ? overrides.get(row.notionUserId) ?? null
      : row.kgPersonId;
  }

  function handleSync() {
    setMessage(null);
    startSync(async () => {
      const res = await syncNotionUsers(workspaceId);
      if (res.ok) {
        setMessage({
          kind: "ok",
          text: `Trajimos ${res.fetched} usuarios de Notion (${res.persons} personas). Nuevos: ${res.inserted}. Actualizados: ${res.updated}. Auto-matcheados: ${res.autoMatched}.`,
        });
      } else {
        setMessage({ kind: "error", text: res.error });
      }
    });
  }

  function handleAutoMatch() {
    setMessage(null);
    startMatch(async () => {
      const res = await autoMatchNotionUsers(workspaceId);
      if (res.ok) {
        setMessage({
          kind: "ok",
          text:
            res.totalUnmapped === 0
              ? "No había usuarios sin mapear."
              : `Auto-matcheados ${res.matched} de ${res.totalUnmapped} usuarios sin mapear.`,
        });
      } else {
        setMessage({ kind: "error", text: res.error });
      }
    });
  }

  async function handleChangeMapping(
    row: NotionUserRow,
    newPersonId: string | null,
  ) {
    // Optimistic — grabamos el override antes del round-trip.
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(row.notionUserId, newPersonId);
      return next;
    });
    const res = await setNotionUserPersonMapping(
      workspaceId,
      row.notionUserId,
      newPersonId,
    );
    if (!res.ok) {
      // Rollback + error message.
      setOverrides((prev) => {
        const next = new Map(prev);
        next.delete(row.notionUserId);
        return next;
      });
      setMessage({
        kind: "error",
        text: `No se pudo guardar el mapeo: ${res.error}`,
      });
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div
        style={{
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={handleAutoMatch}
          disabled={pendingMatch || pendingSync}
          className="kg-focus"
          style={secondaryBtn}
          title="Rematchea por email sin volver a preguntar a Notion"
        >
          {pendingMatch ? "Matcheando…" : "Auto-matchear por email"}
        </button>
        <button
          type="button"
          onClick={handleSync}
          disabled={pendingSync || pendingMatch}
          className="kg-focus"
          style={primaryBtn}
        >
          {pendingSync ? "Sincronizando…" : "Sincronizar ahora"}
        </button>
      </div>

      {message && (
        <div
          style={{
            padding: "10px 14px",
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

      {rows.length === 0 ? (
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
          Todavía no sincronizamos usuarios de este workspace. Click
          "Sincronizar ahora" para traerlos.
        </div>
      ) : (
        <div
          className="kg-glass"
          style={{
            borderRadius: "var(--kg-r-12)",
            border: "1px solid var(--kg-border-subtle)",
            overflow: "hidden",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
            }}
          >
            <thead>
              <tr
                style={{
                  background: "var(--kg-surface-2-solid)",
                  borderBottom: "1px solid var(--kg-border-subtle)",
                }}
              >
                <th style={thStyle}>Usuario Notion</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Mapeo a persona</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const mapping = currentMapping(r);
                const isMapped = mapping != null;
                const modified =
                  overrides.has(r.notionUserId) &&
                  overrides.get(r.notionUserId) !== r.kgPersonId;
                return (
                  <tr
                    key={r.notionUserId}
                    style={{
                      borderBottom: "1px solid var(--kg-border-subtle)",
                    }}
                  >
                    <td style={tdStyle}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        {r.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={r.avatarUrl}
                            alt=""
                            width={28}
                            height={28}
                            style={{ borderRadius: 999 }}
                          />
                        ) : (
                          <div
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: 999,
                              background: "var(--kg-surface-2-solid)",
                              border: "1px solid var(--kg-border-subtle)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "var(--kg-text-3)",
                              fontSize: 11,
                              fontWeight: 700,
                            }}
                          >
                            {(r.name ?? "?").slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <span style={{ color: "var(--kg-text-1)" }}>
                          {r.name ?? "(sin nombre)"}
                        </span>
                      </div>
                    </td>
                    <td style={{ ...tdStyle, color: "var(--kg-text-2)" }}>
                      {r.email ?? "—"}
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <select
                          value={mapping ?? ""}
                          onChange={(e) =>
                            handleChangeMapping(
                              r,
                              e.target.value === "" ? null : e.target.value,
                            )
                          }
                          style={{
                            padding: "6px 10px",
                            borderRadius: "var(--kg-r-8)",
                            background: "var(--kg-bg-base)",
                            border: `1px solid ${
                              isMapped
                                ? "var(--kg-border-subtle)"
                                : "#FFB800"
                            }`,
                            color: "var(--kg-text-1)",
                            fontSize: 12,
                            minWidth: 220,
                          }}
                        >
                          <option value="">Sin mapear</option>
                          {people.map((p) => (
                            <option
                              key={p.id}
                              value={p.id}
                              disabled={!p.active}
                            >
                              {p.fullName}
                              {p.email ? ` · ${p.email}` : ""}
                              {!p.active ? " (inactiva)" : ""}
                            </option>
                          ))}
                        </select>
                        {modified && (
                          <span
                            style={{
                              fontSize: 10,
                              color: "#00D084",
                              fontWeight: 700,
                            }}
                          >
                            ✓ guardado
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "10px 14px",
  textAlign: "left",
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0.3,
  color: "var(--kg-text-3)",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 14px",
  verticalAlign: "middle",
};

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
