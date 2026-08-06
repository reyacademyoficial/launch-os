"use client";

import { useState } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { StatusPill } from "@/components/kg/status-pill";

import {
  CourseFormDrawer,
  type CourseInitial,
  type ProductOptionForCourse,
} from "./course-form-drawer";

export interface CourseRowData {
  readonly id: string;
  readonly productId: string;
  readonly productName: string;
  readonly projectName: string | null;
  readonly durationHours: number | null;
  readonly modulesCount: number | null;
  readonly active: boolean;
  readonly cohortsCount: number;
}

export function CoursesView({
  rows,
  totalCount,
  products,
}: {
  readonly rows: readonly CourseRowData[];
  readonly totalCount: number;
  readonly products: readonly ProductOptionForCourse[];
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const editing =
    editingId != null ? rows.find((r) => r.id === editingId) ?? null : null;
  const editingInitial: CourseInitial | undefined = editing
    ? {
        id: editing.id,
        productId: editing.productId,
        durationHours: editing.durationHours,
        modulesCount: editing.modulesCount,
        active: editing.active,
      }
    : undefined;

  const columns: Column<CourseRowData>[] = [
    {
      key: "product",
      label: "Producto",
      render: (r) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span
            style={{
              color: "var(--kg-text-1)",
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            {r.productName}
          </span>
          {r.projectName && (
            <span className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
              {r.projectName}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "duration",
      label: "Duración",
      align: "right",
      numeric: true,
      render: (r) =>
        r.durationHours == null ? (
          <span style={{ color: "var(--kg-text-3)" }}>—</span>
        ) : (
          `${r.durationHours} h`
        ),
    },
    {
      key: "modules",
      label: "Módulos",
      align: "right",
      numeric: true,
      render: (r) =>
        r.modulesCount == null ? (
          <span style={{ color: "var(--kg-text-3)" }}>—</span>
        ) : (
          String(r.modulesCount)
        ),
    },
    {
      key: "cohorts",
      label: "Cohortes",
      align: "right",
      numeric: true,
      render: (r) =>
        r.cohortsCount === 0 ? (
          <span style={{ color: "var(--kg-text-3)" }}>—</span>
        ) : (
          String(r.cohortsCount)
        ),
    },
    {
      key: "status",
      label: "Estado",
      render: (r) => (
        <StatusPill
          text={r.active ? "Activo" : "Archivado"}
          tone={
            r.active ? "var(--kg-positive-500)" : "var(--kg-neutral-500)"
          }
        />
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
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="kg-focus"
          style={primaryBtn}
        >
          + Nuevo curso
        </button>
      </div>

      <KgDataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        totalCount={totalCount}
        emptyTitle="Sin cursos cargados"
        emptyHint="Un curso es una capa académica sobre un producto existente. Elegí un producto de un proyecto propio para convertirlo en curso."
      />

      <CourseFormDrawer
        mode="create"
        open={creating}
        onClose={() => setCreating(false)}
        products={products}
      />

      <CourseFormDrawer
        mode="edit"
        open={editingId != null}
        onClose={() => setEditingId(null)}
        products={products}
        initial={editingInitial}
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
