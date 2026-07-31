"use client";

import { useState, useTransition } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { fCount, fPct } from "@/lib/finance/format";
import type { TeamMemberRole } from "@/lib/team/types";

import { deleteTeamMember, setTeamMemberActive } from "./actions";
import {
  TeamMemberFormDrawer,
  type ProjectOption,
} from "./team-member-form-drawer";

const ROLE_LABELS: Record<TeamMemberRole, string> = {
  setter: "Setter",
  closer: "Closer",
  media_buyer: "Media buyer",
  manager: "Manager",
  otro: "Otro",
};

export interface TeamMemberRowData {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly name: string;
  readonly role: TeamMemberRole;
  readonly commissionRate: number | null;
  readonly salesCount: number;
  readonly active: boolean;
}

export function EquipoView({
  rows,
  totalCount,
  projects,
}: {
  readonly rows: readonly TeamMemberRowData[];
  readonly totalCount: number;
  readonly projects: readonly ProjectOption[];
}) {
  const [openCreate, setOpenCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingRow = editingId
    ? rows.find((r) => r.id === editingId) ?? null
    : null;

  const columns: Column<TeamMemberRowData>[] = [
    { key: "project", label: "Proyecto", render: (r) => r.projectName },
    { key: "name", label: "Nombre", render: (r) => r.name },
    {
      key: "role",
      label: "Rol",
      render: (r) => <RolePill role={r.role} />,
    },
    {
      key: "commission",
      label: "% Comisión",
      align: "right",
      numeric: true,
      render: (r) =>
        r.commissionRate == null ? "—" : fPct(r.commissionRate / 100),
    },
    {
      key: "sales",
      label: "Ventas",
      align: "right",
      numeric: true,
      render: (r) => fCount(r.salesCount),
    },
    {
      key: "state",
      label: "Estado",
      render: (r) => <ActivePill active={r.active} />,
    },
    {
      key: "actions",
      label: "",
      align: "right",
      render: (r) => (
        <RowActions row={r} onEdit={() => setEditingId(r.id)} />
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          padding: "10px 14px",
          borderBottom: "1px solid var(--kg-border-subtle)",
        }}
      >
        <button
          type="button"
          onClick={() => setOpenCreate(true)}
          disabled={projects.length === 0}
          className="kg-focus"
          style={{
            padding: "6px 14px",
            borderRadius: 999,
            background: "var(--kg-accent-500)",
            color: "#fff",
            border: "none",
            fontSize: 12,
            fontWeight: 700,
            cursor: projects.length === 0 ? "not-allowed" : "pointer",
            opacity: projects.length === 0 ? 0.5 : 1,
          }}
          title={
            projects.length === 0
              ? "Necesitás al menos un proyecto para crear un miembro"
              : "Crear un miembro"
          }
        >
          + Nuevo miembro
        </button>
      </div>

      <KgDataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        totalCount={totalCount}
        emptyTitle="No hay miembros cargados"
        emptyHint="El equipo de ventas se elige al cargar una venta (setter y closer) y alimenta el ranking del proyecto. Cada miembro pertenece a un proyecto."
      />

      <TeamMemberFormDrawer
        mode="create"
        open={openCreate}
        onClose={() => setOpenCreate(false)}
        projects={projects}
      />

      {editingRow && (
        <TeamMemberFormDrawer
          mode="edit"
          open
          onClose={() => setEditingId(null)}
          projects={projects}
          initial={{
            id: editingRow.id,
            projectId: editingRow.projectId,
            name: editingRow.name,
            role: editingRow.role,
            commissionRate: editingRow.commissionRate,
          }}
        />
      )}
    </div>
  );
}

function RowActions({
  row,
  onEdit,
}: {
  readonly row: TeamMemberRowData;
  readonly onEdit: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleToggle() {
    setError(null);
    startTransition(async () => {
      const r = await setTeamMemberActive(row.id, row.projectId, !row.active);
      if ("error" in r) setError(r.error);
    });
  }

  function handleDelete() {
    if (
      !confirm(
        `¿Borrar a "${row.name}"? Solo funciona si no tiene ventas ni payouts — en ese caso desactivalo en lugar de borrar.`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await deleteTeamMember(row.id, row.projectId);
      if ("error" in r) setError(r.error);
    });
  }

  return (
    <div
      style={{
        display: "inline-flex",
        gap: 6,
        justifyContent: "flex-end",
        alignItems: "center",
      }}
    >
      {error && (
        <span style={{ color: "#EF4444", fontSize: 10 }} title={error}>
          ⚠
        </span>
      )}
      <button
        type="button"
        onClick={onEdit}
        className="kg-focus"
        style={ghostBtn}
        title="Editar miembro"
      >
        Editar
      </button>
      <button
        type="button"
        onClick={handleToggle}
        disabled={pending}
        className="kg-focus"
        style={{
          ...ghostBtn,
          color: row.active ? "#EF4444" : "#00D084",
          opacity: pending ? 0.6 : 1,
        }}
        title={row.active ? "Dar de baja" : "Reactivar"}
      >
        {pending ? "…" : row.active ? "Dar de baja" : "Reactivar"}
      </button>
      {row.salesCount === 0 && (
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          className="kg-focus"
          style={{
            ...ghostBtn,
            color: "#EF4444",
            opacity: pending ? 0.6 : 1,
          }}
          title="Borrar (solo si no tiene ventas ni payouts)"
        >
          Borrar
        </button>
      )}
    </div>
  );
}

const ghostBtn: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
};

function RolePill({ role }: { readonly role: TeamMemberRole }) {
  // Colores diferenciados por función: setter/closer son las ventas
  // directas (accent), media_buyer marketing (warning), manager (positive),
  // otro (neutral).
  const spec: Record<TeamMemberRole, { bg: string; fg: string; dot: string }> =
    {
      setter: {
        bg: "rgba(64,120,255,0.15)",
        fg: "#4078FF",
        dot: "#4078FF",
      },
      closer: {
        bg: "rgba(0,208,132,0.15)",
        fg: "#00D084",
        dot: "#00D084",
      },
      media_buyer: {
        bg: "rgba(255,184,0,0.15)",
        fg: "#FFB800",
        dot: "#FFB800",
      },
      manager: {
        bg: "rgba(138,138,153,0.20)",
        fg: "var(--kg-text-1)",
        dot: "#8A8A99",
      },
      otro: {
        bg: "rgba(138,138,153,0.15)",
        fg: "var(--kg-text-2)",
        dot: "#8A8A99",
      },
    };
  const s = spec[role];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        background: s.bg,
        color: s.fg,
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: s.dot,
          display: "inline-block",
        }}
      />
      {ROLE_LABELS[role]}
    </span>
  );
}

function ActivePill({ active }: { readonly active: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        background: active
          ? "rgba(0,208,132,0.15)"
          : "rgba(138,138,153,0.15)",
        color: active ? "#00D084" : "var(--kg-text-2)",
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: active ? "#00D084" : "#8A8A99",
          display: "inline-block",
        }}
      />
      {active ? "Activo" : "Dado de baja"}
    </span>
  );
}
