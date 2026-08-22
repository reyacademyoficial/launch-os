import Link from "next/link";

import { EmptyState } from "@/components/kg/empty-state";
import { IconAca } from "@/components/kg/icons";

// ═══════════════════════════════════════════════════════════════════════════
// Panel de progreso de módulos por enrollment (Fase C).
//
// Server component puro (no interactividad — todo el input viene ya calculado).
// Muestra por cada enrollment activo cuyo curso tenga progress_source
// 'ghl_tags' o 'manual' la lista de módulos con estado completado/pendiente.
// Los enrollments a cursos con 'attendance' no aparecen — no aplican módulos.
// ═══════════════════════════════════════════════════════════════════════════

export interface ModuleProgressEntry {
  readonly moduleId: string;
  readonly moduleName: string;
  readonly orderIndex: number;
  readonly completedAt: string | null;
  readonly source: "ghl_tag" | "manual" | null;
}

export interface EnrollmentProgressGroup {
  readonly enrollmentId: string;
  readonly cohortId: string;
  readonly cohortName: string;
  readonly courseId: string;
  readonly courseName: string;
  readonly progressSource: "attendance" | "ghl_tags" | "manual";
  readonly modules: readonly ModuleProgressEntry[];
}

export function ModulesProgressPanel({
  groups,
}: {
  readonly groups: readonly EnrollmentProgressGroup[];
}) {
  // Solo mostramos enrollments con curso trackeado por módulos.
  const trackedGroups = groups.filter(
    (g) => g.progressSource === "ghl_tags" || g.progressSource === "manual",
  );

  if (trackedGroups.length === 0) {
    return (
      <EmptyState
        icon={<IconAca size={22} />}
        title="Sin módulos trackeados"
        hint="Ninguna de las generaciones actuales usa progreso por módulos (attendance/ghl_tags/manual). En cursos con progress_source='ghl_tags' o 'manual' aparece el detalle acá."
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {trackedGroups.map((g) => {
        const completed = g.modules.filter((m) => m.completedAt != null);
        const total = g.modules.length;
        const pct = total > 0 ? Math.round((completed.length / total) * 100) : 0;

        return (
          <div
            key={g.enrollmentId}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: "12px 14px",
              borderRadius: "var(--kg-r-8)",
              background: "var(--kg-surface-2-solid)",
              border: "1px solid var(--kg-border-subtle)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <div>
                <Link
                  href={`/academia/cursos/${g.courseId}`}
                  className="kg-focus"
                  style={{
                    color: "var(--kg-text-1)",
                    fontWeight: 600,
                    fontSize: 13,
                    textDecoration: "none",
                  }}
                >
                  {g.courseName}
                </Link>
                <div
                  className="kg-t7"
                  style={{ color: "var(--kg-text-3)", marginTop: 2 }}
                >
                  {g.cohortName} · {g.progressSource}
                </div>
              </div>
              <div
                className="kg-t7"
                style={{
                  color: "var(--kg-text-2)",
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 700,
                }}
              >
                {completed.length}/{total} · {pct}%
              </div>
            </div>

            {total === 0 ? (
              <div
                className="kg-t7"
                style={{
                  color: "var(--kg-text-3)",
                  fontStyle: "italic",
                  padding: "4px 0",
                }}
              >
                El curso no tiene módulos cargados todavía.
              </div>
            ) : (
              <ul
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                {g.modules.map((m) => {
                  const done = m.completedAt != null;
                  return (
                    <li
                      key={m.moduleId}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "4px 0",
                        fontSize: 12,
                      }}
                    >
                      <span
                        aria-hidden
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: 999,
                          background: done
                            ? "var(--kg-positive-500)"
                            : "var(--kg-surface-1-solid)",
                          border: `1px solid ${done ? "var(--kg-positive-500)" : "var(--kg-border-subtle)"}`,
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          color: done ? "var(--kg-text-1)" : "var(--kg-text-3)",
                          textDecoration: done ? "none" : "none",
                          fontWeight: done ? 600 : 400,
                        }}
                      >
                        {m.orderIndex + 1}. {m.moduleName}
                      </span>
                      {done && m.completedAt && (
                        <span
                          className="kg-t7"
                          style={{
                            color: "var(--kg-text-3)",
                            marginLeft: "auto",
                          }}
                        >
                          {formatDate(m.completedAt)}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}
