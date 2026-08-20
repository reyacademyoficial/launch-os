"use client";

import Link from "next/link";
import { useState } from "react";

import {
  TimeEntryFormDrawer,
  type PersonOptionForTimeEntry,
  type ProjectOptionForTimeEntry,
  type TaskOptionForTimeEntry,
} from "../../tiempo/time-entry-form-drawer";

// ═══════════════════════════════════════════════════════════════════════════
// Sub-sección "Tiempo dedicado" dentro de la ficha del internal_project.
//
// Suma TODO el tiempo cargado que apunta al proyecto — sea directamente
// (internal_project_id = X) o a través de una tarea del proyecto
// (task_id ∈ tareas del proyecto). El agregado se calcula server-side y
// llega ya masticado en `perPerson` + `total`.
//
// La lista de "últimos registros" ayuda al operador a ver actividad reciente
// sin ir al listado global. Edición y delete viven en /operaciones/tiempo.
// ═══════════════════════════════════════════════════════════════════════════

export interface ProjectTimeBreakdown {
  readonly personId: string;
  readonly personName: string;
  readonly minutes: number;
}

export interface ProjectTimeEntry {
  readonly id: string;
  readonly personName: string;
  readonly minutes: number;
  readonly loggedOn: string;
  /** Título de la tarea si el registro apuntaba a una task. Null = directo al proyecto. */
  readonly taskTitle: string | null;
  readonly notes: string | null;
}

const RECENT_LIMIT = 5;
const PER_PERSON_LIMIT = 6;

export function ProjectTimeSection({
  projectId,
  totalMinutes,
  perPerson,
  recent,
  peopleForDrawer,
  tasksForDrawer,
  projectsForDrawer,
}: {
  readonly projectId: string;
  readonly totalMinutes: number;
  /** Ya agregado + ordenado desc por minutos server-side. */
  readonly perPerson: readonly ProjectTimeBreakdown[];
  /** Últimos registros ordenados por logged_on desc (top N server-side). */
  readonly recent: readonly ProjectTimeEntry[];
  readonly peopleForDrawer: readonly PersonOptionForTimeEntry[];
  readonly tasksForDrawer: readonly TaskOptionForTimeEntry[];
  readonly projectsForDrawer: readonly ProjectOptionForTimeEntry[];
}) {
  const [creating, setCreating] = useState(false);

  const totalHours = totalMinutes / 60;
  const activePeopleCount = perPerson.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div
            style={{
              color: "var(--kg-text-1)",
              fontSize: 22,
              fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1.1,
            }}
          >
            {totalHours === 0 ? "0" : totalHours.toFixed(1)} h
          </div>
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-3)" }}
          >
            {activePeopleCount === 0
              ? "sin registros aún"
              : `total sobre ${activePeopleCount} persona${activePeopleCount === 1 ? "" : "s"}`}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="kg-focus"
          style={primaryBtn}
        >
          + Cargar tiempo
        </button>
      </header>

      {perPerson.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div
            className="kg-t7"
            style={{
              color: "var(--kg-text-3)",
              textTransform: "uppercase",
              letterSpacing: 0.3,
              fontWeight: 700,
              paddingTop: 4,
            }}
          >
            Por persona
          </div>
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 3,
            }}
          >
            {perPerson.slice(0, PER_PERSON_LIMIT).map((p) => (
              <li
                key={p.personId}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: 12,
                  padding: "4px 0",
                }}
              >
                <span style={{ color: "var(--kg-text-1)" }}>
                  {p.personName}
                </span>
                <span
                  style={{
                    color: "var(--kg-text-2)",
                    fontVariantNumeric: "tabular-nums",
                    fontWeight: 600,
                  }}
                >
                  {(p.minutes / 60).toFixed(1)} h
                </span>
              </li>
            ))}
            {perPerson.length > PER_PERSON_LIMIT && (
              <li
                className="kg-t7"
                style={{ color: "var(--kg-text-3)", paddingTop: 2 }}
              >
                +{perPerson.length - PER_PERSON_LIMIT} más
              </li>
            )}
          </ul>
        </div>
      )}

      {recent.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div
            className="kg-t7"
            style={{
              color: "var(--kg-text-3)",
              textTransform: "uppercase",
              letterSpacing: 0.3,
              fontWeight: 700,
              paddingTop: 8,
            }}
          >
            Últimos registros
          </div>
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {recent.slice(0, RECENT_LIMIT).map((e) => (
              <li
                key={e.id}
                style={{
                  padding: "8px 10px",
                  borderRadius: "var(--kg-r-8)",
                  background: "var(--kg-surface-2-solid)",
                  border: "1px solid var(--kg-border-subtle)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 12,
                  }}
                >
                  <span
                    style={{
                      color: "var(--kg-text-1)",
                      fontWeight: 600,
                    }}
                  >
                    {e.personName}
                  </span>
                  <span
                    style={{
                      color: "var(--kg-text-2)",
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {(e.minutes / 60).toFixed(1)} h · {formatDate(e.loggedOn)}
                  </span>
                </div>
                {(e.taskTitle || e.notes) && (
                  <div
                    className="kg-t7"
                    style={{
                      color: "var(--kg-text-3)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={
                      [e.taskTitle, e.notes]
                        .filter((x): x is string => !!x)
                        .join(" — ") || undefined
                    }
                  >
                    {e.taskTitle && (
                      <span style={{ color: "var(--kg-text-2)" }}>
                        {e.taskTitle}
                      </span>
                    )}
                    {e.taskTitle && e.notes && " · "}
                    {e.notes}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {totalMinutes === 0 && (
        <div
          className="kg-t7"
          style={{
            color: "var(--kg-text-3)",
            padding: "18px 4px",
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          Nadie cargó tiempo todavía. Cargá el primero arriba o desde el
          listado global.
        </div>
      )}

      <Link
        href={`/operaciones/tiempo?projectId=${projectId}&range=todo`}
        className="kg-focus"
        style={viewAllLink}
      >
        Ver todos en el listado global →
      </Link>

      <TimeEntryFormDrawer
        mode="create"
        open={creating}
        onClose={() => setCreating(false)}
        people={peopleForDrawer}
        tasks={tasksForDrawer}
        projects={projectsForDrawer}
        presetProjectId={projectId}
      />
    </div>
  );
}

function formatDate(ymd: string): string {
  try {
    return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "short",
    });
  } catch {
    return ymd.slice(0, 10);
  }
}

const primaryBtn: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: 999,
  background: "var(--kg-accent-500)",
  border: "none",
  color: "#fff",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const viewAllLink: React.CSSProperties = {
  color: "var(--kg-text-2)",
  fontSize: 11,
  fontWeight: 700,
  textDecoration: "none",
  padding: "4px 0",
  alignSelf: "flex-start",
};
