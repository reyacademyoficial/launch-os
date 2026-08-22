"use client";

import Link from "next/link";
import { useState } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { StatusPill } from "@/components/kg/status-pill";

import {
  CohortFormDrawer,
  type CohortInitial,
  type CourseOptionForCohort,
  type ProjectOptionForCohort,
  type SystemOptionForCohort,
} from "./cohort-form-drawer";

type Status = "planned" | "active" | "finished" | "cancelled";

export interface CohortRowData {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string | null;
  readonly courseId: string | null;
  readonly courseName: string | null;
  readonly systemId: string | null;
  readonly name: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly status: Status;
  readonly notes: string | null;
  readonly enrollmentsCount: number;
}

const STATUS_LABEL: Record<Status, string> = {
  planned: "Planeada",
  active: "Activa",
  finished: "Terminada",
  cancelled: "Cancelada",
};

const STATUS_TONE: Record<Status, string> = {
  planned: "var(--kg-neutral-500)",
  active: "var(--kg-positive-500)",
  finished: "var(--kg-accent-500)",
  cancelled: "var(--kg-negative-500)",
};

export function CohortsView({
  rows,
  totalCount,
  projects,
  courses,
  systems,
}: {
  readonly rows: readonly CohortRowData[];
  readonly totalCount: number;
  readonly projects: readonly ProjectOptionForCohort[];
  readonly courses: readonly CourseOptionForCohort[];
  readonly systems?: readonly SystemOptionForCohort[];
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const editing =
    editingId != null ? rows.find((r) => r.id === editingId) ?? null : null;
  const editingInitial: CohortInitial | undefined = editing
    ? {
        id: editing.id,
        projectId: editing.projectId,
        courseId: editing.courseId,
        systemId: editing.systemId,
        name: editing.name,
        startDate: editing.startDate,
        endDate: editing.endDate,
        status: editing.status,
        notes: editing.notes,
      }
    : undefined;

  const columns: Column<CohortRowData>[] = [
    {
      key: "name",
      label: "Generación",
      render: (r) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Link
            href={`/academia/cohortes/${r.id}`}
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
      key: "course",
      label: "Curso",
      render: (r) =>
        r.courseName ?? (
          <span style={{ color: "var(--kg-text-3)" }}>Sin curso</span>
        ),
    },
    {
      key: "period",
      label: "Período",
      render: (r) => `${formatDate(r.startDate)} – ${formatDate(r.endDate)}`,
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
      label: "Inscriptos",
      align: "right",
      numeric: true,
      render: (r) =>
        r.enrollmentsCount === 0 ? (
          <span style={{ color: "var(--kg-text-3)" }}>—</span>
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
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="kg-focus"
          style={primaryBtn}
        >
          + Nueva generación
        </button>
      </div>

      <KgDataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        totalCount={totalCount}
        emptyTitle="Sin generaciones que coincidan con el filtro"
        emptyHint="Cambiá el filtro o creá una generación nueva."
      />

      <CohortFormDrawer
        mode="create"
        open={creating}
        onClose={() => setCreating(false)}
        projects={projects}
        courses={courses}
        systems={systems}
      />

      <CohortFormDrawer
        mode="edit"
        open={editingId != null}
        onClose={() => setEditingId(null)}
        projects={projects}
        courses={courses}
        systems={systems}
        initial={editingInitial}
      />
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
