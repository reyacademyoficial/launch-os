"use client";

import Link from "next/link";
import { useState } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { StatusPill } from "@/components/kg/status-pill";

import {
  CreateFromSaleDrawer,
  type PendingSale,
} from "./create-from-sale-drawer";
import {
  StudentFormDrawer,
  type ProjectOptionForStudent,
  type StudentInitial,
} from "./student-form-drawer";

type Status = "active" | "inactive" | "graduated";

export interface StudentRowData {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string | null;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly status: Status;
  readonly notes: string | null;
  readonly enrollmentsCount: number;
}

const STATUS_LABEL: Record<Status, string> = {
  active: "Activo",
  inactive: "Inactivo",
  graduated: "Graduado",
};

const STATUS_TONE: Record<Status, string> = {
  active: "var(--kg-positive-500)",
  inactive: "var(--kg-neutral-500)",
  graduated: "var(--kg-accent-500)",
};

export function StudentsView({
  rows,
  totalCount,
  projects,
  pendingSales,
}: {
  readonly rows: readonly StudentRowData[];
  readonly totalCount: number;
  readonly projects: readonly ProjectOptionForStudent[];
  readonly pendingSales: readonly PendingSale[];
}) {
  const [creatingManual, setCreatingManual] = useState(false);
  const [creatingFromSale, setCreatingFromSale] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const editing =
    editingId != null ? rows.find((r) => r.id === editingId) ?? null : null;
  const editingInitial: StudentInitial | undefined = editing
    ? {
        id: editing.id,
        projectId: editing.projectId,
        name: editing.name,
        email: editing.email,
        phone: editing.phone,
        status: editing.status,
        notes: editing.notes,
      }
    : undefined;

  const columns: Column<StudentRowData>[] = [
    {
      key: "name",
      label: "Estudiante",
      render: (r) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Link
            href={`/academia/estudiantes/${r.id}`}
            className="kg-focus"
            style={{
              color: "var(--kg-text-1)",
              textDecoration: "none",
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            {r.name}
          </Link>
          {r.projectName && (
            <span className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
              {r.projectName}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "contact",
      label: "Contacto",
      render: (r) =>
        r.email || r.phone ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {r.email && <span style={{ fontSize: 12 }}>{r.email}</span>}
            {r.phone && (
              <span
                className="kg-t7"
                style={{ color: "var(--kg-text-3)" }}
              >
                {r.phone}
              </span>
            )}
          </div>
        ) : (
          <span style={{ color: "var(--kg-text-3)" }}>—</span>
        ),
    },
    {
      key: "status",
      label: "Estado",
      render: (r) => (
        <StatusPill text={STATUS_LABEL[r.status]} tone={STATUS_TONE[r.status]} />
      ),
    },
    {
      key: "enrollments",
      label: "Generaciones",
      align: "right",
      numeric: true,
      render: (r) =>
        r.enrollmentsCount === 0 ? (
          <span
            style={{ color: "var(--kg-text-3)", fontSize: 12, fontStyle: "italic" }}
            title="Estudiante sin generación asignada"
          >
            sin asignar
          </span>
        ) : (
          String(r.enrollmentsCount)
        ),
    },
    {
      key: "actions",
      label: "",
      align: "right",
      render: (r) => (
        <button
          type="button"
          onClick={() => setEditingId(r.id)}
          className="kg-focus"
          style={rowBtn}
        >
          Editar
        </button>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={() => setCreatingFromSale(true)}
          className="kg-focus"
          style={secondaryBtn}
        >
          + Desde comprador
          {pendingSales.length > 0 && (
            <span
              style={{
                marginLeft: 6,
                padding: "1px 6px",
                borderRadius: 999,
                background: "var(--kg-accent-500)",
                color: "#fff",
                fontSize: 10,
                fontWeight: 700,
              }}
            >
              {pendingSales.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setCreatingManual(true)}
          className="kg-focus"
          style={primaryBtn}
        >
          + Crear manual
        </button>
      </div>

      <KgDataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        totalCount={totalCount}
        emptyTitle="Sin estudiantes que coincidan con el filtro"
        emptyHint="Los estudiantes son los alumnos de las empresas propias. Se cargan desde una venta LaunchOS (auto-fill) o manual."
      />

      <StudentFormDrawer
        mode="create"
        open={creatingManual}
        onClose={() => setCreatingManual(false)}
        projects={projects}
      />

      <StudentFormDrawer
        mode="edit"
        open={editingId != null}
        onClose={() => setEditingId(null)}
        projects={projects}
        initial={editingInitial}
      />

      <CreateFromSaleDrawer
        open={creatingFromSale}
        onClose={() => setCreatingFromSale(false)}
        pendingSales={pendingSales}
      />
    </div>
  );
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
  display: "inline-flex",
  alignItems: "center",
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
