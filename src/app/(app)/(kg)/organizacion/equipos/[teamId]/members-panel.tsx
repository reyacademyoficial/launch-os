"use client";

import { useState, useTransition } from "react";

import { EmptyState } from "@/components/kg/empty-state";

import { addMember, removeMember } from "./actions";

export interface MemberRowData {
  readonly membershipId: string;
  readonly personId: string;
  readonly personName: string;
  readonly personActive: boolean;
  readonly roleInTeam: string | null;
  readonly joinedAt: string;
  readonly leftAt: string | null;
  readonly active: boolean;
}

export interface AvailablePerson {
  readonly id: string;
  readonly fullName: string;
}

export function MembersPanel({
  teamId,
  members,
  availablePeople,
}: {
  readonly teamId: string;
  readonly members: readonly MemberRowData[];
  readonly availablePeople: readonly AvailablePerson[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState<string>("");
  const [role, setRole] = useState<string>("");

  const active = members.filter((m) => m.active);
  const historical = members.filter((m) => !m.active);

  function handleAdd() {
    if (!selectedPersonId) {
      setError("Elegí una persona.");
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set("person_id", selectedPersonId);
    if (role.trim().length > 0) fd.set("role_in_team", role.trim());
    startTransition(async () => {
      const result = await addMember(teamId, fd);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setSelectedPersonId("");
      setRole("");
    });
  }

  function handleRemove(m: MemberRowData) {
    const ok = window.confirm(
      `¿Quitar a ${m.personName} del equipo? Su historial se preserva y puede volver a agregarse después.`,
    );
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const result = await removeMember(m.membershipId);
      if ("error" in result) setError(result.error);
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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

      {/* Form inline para sumar miembro */}
      {availablePeople.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr auto",
            gap: 8,
            padding: 12,
            borderRadius: "var(--kg-r-8)",
            background: "var(--kg-surface-2-solid)",
            border: "1px solid var(--kg-border-subtle)",
          }}
        >
          <select
            value={selectedPersonId}
            onChange={(e) => setSelectedPersonId(e.target.value)}
            disabled={pending}
            style={inputStyle}
          >
            <option value="">— Elegí persona —</option>
            {availablePeople.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            disabled={pending}
            placeholder="Rol (opcional)"
            style={inputStyle}
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={pending || !selectedPersonId}
            className="kg-focus"
            style={{
              ...primaryBtn,
              opacity: pending || !selectedPersonId ? 0.6 : 1,
            }}
          >
            {pending ? "Sumando…" : "+ Sumar"}
          </button>
        </div>
      )}

      {active.length === 0 ? (
        <EmptyState
          title="Sin miembros activos"
          hint={
            availablePeople.length > 0
              ? "Sumá personas usando el form de arriba."
              : "No hay más personas activas para sumar. Cargá personas nuevas en Organización → Personas o reactivá una existente."
          }
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {active.map((m) => (
            <MemberRow
              key={m.membershipId}
              member={m}
              onRemove={handleRemove}
              disabled={pending}
            />
          ))}
        </div>
      )}

      {historical.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowHistory(!showHistory)}
            className="kg-focus"
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              color: "var(--kg-text-3)",
              fontSize: 12,
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            {showHistory ? "Ocultar" : "Ver"} historial (
            {historical.length}{" "}
            {historical.length === 1 ? "membresía cerrada" : "membresías cerradas"})
          </button>

          {showHistory && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                marginTop: 10,
              }}
            >
              {historical.map((m) => (
                <div
                  key={m.membershipId}
                  style={{
                    padding: "8px 12px",
                    borderRadius: "var(--kg-r-8)",
                    background: "var(--kg-surface-2-solid)",
                    border: "1px solid var(--kg-border-subtle)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    opacity: 0.7,
                  }}
                >
                  <div>
                    <span
                      style={{
                        color: "var(--kg-text-2)",
                        fontSize: 12,
                      }}
                    >
                      {m.personName}
                    </span>
                    {m.roleInTeam && (
                      <span
                        style={{
                          color: "var(--kg-text-3)",
                          fontSize: 11,
                          marginLeft: 8,
                        }}
                      >
                        · {m.roleInTeam}
                      </span>
                    )}
                  </div>
                  <span
                    className="kg-t7"
                    style={{ color: "var(--kg-text-3)" }}
                  >
                    {formatDate(m.joinedAt)}
                    {m.leftAt ? ` → ${formatDate(m.leftAt)}` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MemberRow({
  member,
  onRemove,
  disabled,
}: {
  readonly member: MemberRowData;
  readonly onRemove: (m: MemberRowData) => void;
  readonly disabled: boolean;
}) {
  return (
    <div
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
          style={{
            color: "var(--kg-text-1)",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {member.personName}
          {!member.personActive && (
            <span
              style={{
                marginLeft: 8,
                color: "var(--kg-text-3)",
                fontSize: 11,
                fontWeight: 400,
              }}
            >
              (persona inactiva)
            </span>
          )}
        </div>
        <div
          className="kg-t7"
          style={{
            color: "var(--kg-text-3)",
            marginTop: 2,
            display: "flex",
            gap: 10,
          }}
        >
          {member.roleInTeam && <span>{member.roleInTeam}</span>}
          <span>desde {formatDate(member.joinedAt)}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onRemove(member)}
        disabled={disabled}
        className="kg-focus"
        style={{
          padding: "4px 12px",
          borderRadius: 999,
          background: "transparent",
          border: "1px solid var(--kg-border-subtle)",
          color: "var(--kg-text-2)",
          fontSize: 11,
          fontWeight: 600,
          cursor: disabled ? "wait" : "pointer",
        }}
      >
        Quitar
      </button>
    </div>
  );
}

function formatDate(ymd: string): string {
  try {
    return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return ymd.slice(0, 10);
  }
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  borderRadius: "var(--kg-r-8)",
  background: "var(--kg-surface-1-solid)",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-1)",
  fontSize: 13,
  colorScheme: "dark",
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
