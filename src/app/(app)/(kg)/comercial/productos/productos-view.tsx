"use client";

import { useState, useTransition } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { fCount } from "@/lib/finance/format";

import { deleteProduct, setProductActive } from "./actions";
import {
  ProductFormDrawer,
  type ProjectOption,
} from "./product-form-drawer";

export interface ProductRowData {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly name: string;
  readonly description: string | null;
  readonly salesCount: number;
  readonly active: boolean;
}

export function ProductosView({
  rows,
  totalCount,
  projects,
}: {
  readonly rows: readonly ProductRowData[];
  readonly totalCount: number;
  readonly projects: readonly ProjectOption[];
}) {
  const [openCreate, setOpenCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingRow = editingId
    ? rows.find((r) => r.id === editingId) ?? null
    : null;

  const columns: Column<ProductRowData>[] = [
    { key: "project", label: "Proyecto", render: (r) => r.projectName },
    { key: "name", label: "Producto", render: (r) => r.name },
    {
      key: "description",
      label: "Descripción",
      render: (r) =>
        r.description ? (
          <span title={r.description} style={ellipsis}>
            {r.description}
          </span>
        ) : (
          "—"
        ),
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
              ? "Necesitás al menos un proyecto para crear un producto"
              : "Crear un producto"
          }
        >
          + Nuevo producto
        </button>
      </div>

      <KgDataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        totalCount={totalCount}
        emptyTitle="No hay productos cargados"
        emptyHint="Los productos son el catálogo del proyecto (Programa Anual, Consultoría, Curso Intensivo…). Se eligen al cargar una venta desde el kanban de leads o la tab de cobros."
      />

      <ProductFormDrawer
        mode="create"
        open={openCreate}
        onClose={() => setOpenCreate(false)}
        projects={projects}
      />

      {editingRow && (
        <ProductFormDrawer
          mode="edit"
          open
          onClose={() => setEditingId(null)}
          projects={projects}
          initial={{
            id: editingRow.id,
            projectId: editingRow.projectId,
            name: editingRow.name,
            description: editingRow.description,
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
  readonly row: ProductRowData;
  readonly onEdit: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleToggle() {
    setError(null);
    startTransition(async () => {
      const r = await setProductActive(row.id, row.projectId, !row.active);
      if ("error" in r) setError(r.error);
    });
  }

  function handleDelete() {
    if (
      !confirm(
        `¿Borrar el producto "${row.name}"? Solo funciona si no tiene ventas — en ese caso desactivalo en lugar de borrar.`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await deleteProduct(row.id, row.projectId);
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
        title="Editar producto"
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
          title="Borrar (solo si no tiene ventas)"
        >
          Borrar
        </button>
      )}
    </div>
  );
}

const ellipsis: React.CSSProperties = {
  display: "inline-block",
  maxWidth: 320,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  verticalAlign: "middle",
};

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
