"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { StatusPill } from "@/components/kg/status-pill";

import {
  StudentFormDrawer,
  type ProjectOptionForStudent,
  type StudentInitial,
} from "./student-form-drawer";

const SEARCH_KEY = "academia:search:estudiantes";

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
}: {
  readonly rows: readonly StudentRowData[];
  readonly totalCount: number;
  readonly projects: readonly ProjectOptionForStudent[];
}) {
  const [creatingManual, setCreatingManual] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Persistir el search en localStorage. Sin SSR — el estado arranca en ""
  // y al montar leemos la key. Evitamos flash del listado completo con la
  // heurística "no aplicar filtro hasta que restauramos" (siempre corto —
  // milisegundos).
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SEARCH_KEY);
      if (saved != null) setQuery(saved);
    } catch {
      // ignorar (SSR / storage bloqueado)
    }
    setRestored(true);
  }, []);
  useEffect(() => {
    if (!restored) return;
    try {
      if (query.trim() === "") {
        window.localStorage.removeItem(SEARCH_KEY);
      } else {
        window.localStorage.setItem(SEARCH_KEY, query);
      }
    } catch {
      // ignorar
    }
  }, [query, restored]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return rows;
    return rows.filter((r) => {
      if (r.name.toLowerCase().includes(q)) return true;
      if (r.email && r.email.toLowerCase().includes(q)) return true;
      if (r.phone && r.phone.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [rows, query]);

  const editing =
    editingId != null
      ? filteredRows.find((r) => r.id === editingId) ??
        rows.find((r) => r.id === editingId) ??
        null
      : null;
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
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flex: 1,
            minWidth: 220,
            maxWidth: 420,
          }}
        >
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre, email o teléfono…"
            aria-label="Buscar estudiantes"
            style={searchInputStyle}
          />
          {query.length > 0 && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="kg-focus"
              style={rowBtn}
              aria-label="Limpiar búsqueda"
            >
              Limpiar
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setCreatingManual(true)}
          className="kg-focus"
          style={primaryBtn}
        >
          + Crear manual
        </button>
      </div>

      {query.trim().length > 0 && (
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", padding: "0 2px" }}
        >
          {filteredRows.length} de {rows.length} coinciden con “{query}”
        </div>
      )}

      <KgDataTable
        columns={columns}
        rows={filteredRows}
        rowKey={(r) => r.id}
        totalCount={filteredRows.length}
        emptyTitle="Sin estudiantes que coincidan"
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

const searchInputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: "8px 12px",
  borderRadius: 999,
  background: "var(--kg-surface-2-solid)",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-1)",
  fontSize: 12,
  colorScheme: "dark",
};
