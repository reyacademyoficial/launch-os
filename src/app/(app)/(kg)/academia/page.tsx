import type { Metadata } from "next";
import Link from "next/link";

import { ContextBar } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import { IconAca } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { StatusPill } from "@/components/kg/status-pill";
import {
  activeStudents as computeActiveStudents,
  averageAttendance,
  certificationRate,
  completionRate,
  examPassRate,
} from "@/lib/academia/kpis";
import { fCount } from "@/lib/finance/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Academia" };

// ═══════════════════════════════════════════════════════════════════════════
// Dashboard del módulo Academia.
//
// Consume los 5 KPIs puros de src/lib/academia/kpis.ts: cero lógica de
// negocio nueva acá — solo fetch + shaping por cohorte.
//
// Snapshot completo sin rango temporal: academia es acumulativa
// (certificados emitidos, aprobación histórica), no de "últimos N días".
// ═══════════════════════════════════════════════════════════════════════════

type CohortStatus = "planned" | "active" | "finished" | "cancelled";
type StudentStatus = "active" | "inactive" | "graduated";
type EnrollStatus = "active" | "completed" | "dropped" | "suspended";

interface StudentDbRow {
  readonly id: string;
  readonly project_id: string;
  readonly status: StudentStatus;
}

interface EnrollmentDbRow {
  readonly id: string;
  readonly cohort_id: string;
  readonly student_id: string;
  readonly status: EnrollStatus;
}

interface CohortDbRow {
  readonly id: string;
  readonly project_id: string;
  readonly course_id: string | null;
  readonly name: string;
  readonly status: CohortStatus;
  readonly start_date: string;
  readonly end_date: string;
}

interface ClassDbRow {
  readonly id: string;
  readonly cohort_id: string;
}

interface AttendanceDbRow {
  readonly class_id: string;
  readonly present: boolean;
}

interface ExamDbRow {
  readonly id: string;
  readonly cohort_id: string;
  readonly passed: boolean | null;
}

interface CertDbRow {
  readonly id: string;
  readonly student_id: string;
}

interface ProjectDbRow {
  readonly id: string;
  readonly name: string;
}

const COHORT_ORDER: Record<CohortStatus, number> = {
  active: 0,
  planned: 1,
  finished: 2,
  cancelled: 3,
};

const COHORT_LABEL: Record<CohortStatus, string> = {
  planned: "Planeada",
  active: "Activa",
  finished: "Terminada",
  cancelled: "Cancelada",
};

const COHORT_TONE: Record<CohortStatus, string> = {
  planned: "var(--kg-neutral-500)",
  active: "var(--kg-positive-500)",
  finished: "var(--kg-accent-500)",
  cancelled: "var(--kg-negative-500)",
};

export default async function AcademiaDashboardPage() {
  const supabase = await createClient();

  const [
    studentsRes,
    enrollmentsRes,
    cohortsRes,
    classesRes,
    attendanceRes,
    examsRes,
    certsRes,
    projectsRes,
  ] = await Promise.all([
    supabase.from("students").select("id, project_id, status"),
    supabase.from("enrollments").select("id, cohort_id, student_id, status"),
    supabase
      .from("cohorts")
      .select(
        "id, project_id, course_id, name, status, start_date, end_date",
      ),
    supabase.from("classes").select("id, cohort_id"),
    supabase.from("attendance").select("class_id, present"),
    supabase.from("exams").select("id, cohort_id, passed"),
    supabase.from("certificates").select("id, student_id"),
    supabase
      .from("projects")
      .select("id, name")
      .eq("ownership", "propia"),
  ]);

  const students = (studentsRes.data ?? []) as unknown as StudentDbRow[];
  const enrollments =
    (enrollmentsRes.data ?? []) as unknown as EnrollmentDbRow[];
  const cohorts = (cohortsRes.data ?? []) as unknown as CohortDbRow[];
  const classes = (classesRes.data ?? []) as unknown as ClassDbRow[];
  const attendance =
    (attendanceRes.data ?? []) as unknown as AttendanceDbRow[];
  const exams = (examsRes.data ?? []) as unknown as ExamDbRow[];
  const certs = (certsRes.data ?? []) as unknown as CertDbRow[];
  const propiaProjects =
    (projectsRes.data ?? []) as unknown as ProjectDbRow[];

  // ── Empty gate: sin proyectos propios el módulo no arranca. Lo aclara
  //    el banner del layout, pero el dashboard además muestra el
  //    empty-state explícito.
  const noPropiaProjects = propiaProjects.length === 0;

  // ── KPIs globales usando los selectores puros.
  const activeCount = computeActiveStudents(students);
  const compRate = completionRate(enrollments);
  const attRate = averageAttendance(attendance);
  const passRate = examPassRate(exams);
  const certRate = certificationRate(certs, students.length);

  // ── Header stats: estado actual, no performance histórica.
  const activeCohorts = cohorts.filter((c) => c.status === "active").length;
  const pendingExams = exams.filter((e) => e.passed === null).length;

  // ── Tabla por generación: bucketear attendance/exams/enrollments por
  //    cohort_id y computar los KPIs de a cohort.
  const classToCohort = new Map<string, string>();
  for (const c of classes) classToCohort.set(c.id, c.cohort_id);

  const attendanceByCohort = new Map<string, AttendanceDbRow[]>();
  for (const a of attendance) {
    const cohortId = classToCohort.get(a.class_id);
    if (!cohortId) continue;
    const bucket = attendanceByCohort.get(cohortId) ?? [];
    bucket.push(a);
    attendanceByCohort.set(cohortId, bucket);
  }

  const enrollmentsByCohort = new Map<string, EnrollmentDbRow[]>();
  for (const e of enrollments) {
    const bucket = enrollmentsByCohort.get(e.cohort_id) ?? [];
    bucket.push(e);
    enrollmentsByCohort.set(e.cohort_id, bucket);
  }

  const examsByCohort = new Map<string, ExamDbRow[]>();
  for (const e of exams) {
    const bucket = examsByCohort.get(e.cohort_id) ?? [];
    bucket.push(e);
    examsByCohort.set(e.cohort_id, bucket);
  }

  const projectNameById = new Map<string, string>();
  for (const p of propiaProjects) projectNameById.set(p.id, p.name);

  interface CohortRow {
    readonly id: string;
    readonly name: string;
    readonly projectName: string;
    readonly status: CohortStatus;
    readonly startDate: string;
    readonly enrolled: number;
    readonly completed: number;
    readonly attendancePct: number | null;
    readonly passPct: number | null;
  }

  const cohortRows: CohortRow[] = cohorts
    .map((c) => {
      const cohortEnrollments = enrollmentsByCohort.get(c.id) ?? [];
      const cohortAttendance = attendanceByCohort.get(c.id) ?? [];
      const cohortExams = examsByCohort.get(c.id) ?? [];
      const completed = cohortEnrollments.reduce(
        (n, e) => (e.status === "completed" ? n + 1 : n),
        0,
      );
      return {
        id: c.id,
        name: c.name,
        projectName: projectNameById.get(c.project_id) ?? "—",
        status: c.status,
        startDate: c.start_date,
        enrolled: cohortEnrollments.length,
        completed,
        attendancePct: averageAttendance(cohortAttendance),
        passPct: examPassRate(cohortExams),
      };
    })
    .sort((a, b) => {
      const order = COHORT_ORDER[a.status] - COHORT_ORDER[b.status];
      if (order !== 0) return order;
      // Dentro de cada bucket, más reciente arriba (start_date desc).
      return b.startDate.localeCompare(a.startDate);
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconAca size={16} />}
        title="Academia"
        stats={[
          { l: "Estudiantes activos", v: fCount(activeCount) },
          { l: "Generaciones activas", v: fCount(activeCohorts) },
          {
            l: "Exámenes pendientes",
            v: fCount(pendingExams),
            c: pendingExams > 0 ? "#FFB800" : undefined,
          },
          { l: "Certificados emitidos", v: fCount(certs.length) },
        ]}
      />

      {noPropiaProjects ? (
        <Panel title="Salud de la academia">
          <EmptyState
            icon={<IconAca size={22} />}
            title="Sin proyectos propios"
            hint="Academia se activa cuando la organización opera al menos un proyecto con ownership='propia' (Rey Academy, Growins). Ver el banner arriba para el SQL de setup."
          />
        </Panel>
      ) : students.length === 0 && cohorts.length === 0 ? (
        <Panel title="Salud de la academia">
          <EmptyState
            icon={<IconAca size={22} />}
            title="Sin datos cargados aún"
            hint="Empezá cargando un curso desde Cursos, después una generación, y desde ahí inscribí estudiantes. El dashboard se rellena solo a medida que aparecen datos."
          />
        </Panel>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 16,
            }}
          >
            <KpiCard
              label="Estudiantes activos"
              value={fCount(activeCount)}
              hint={`${students.length} en total (incluye graduados e inactivos)`}
            />
            <KpiCard
              label="Tasa de finalización"
              value={formatPct(compRate)}
              hint={
                enrollments.length === 0
                  ? "Sin inscripciones cargadas"
                  : `${countByStatus(enrollments, "completed")} de ${enrollments.length} inscripciones`
              }
            />
            <KpiCard
              label="Asistencia promedio"
              value={formatPct(attRate)}
              hint={
                attendance.length === 0
                  ? "Sin registros"
                  : `${attendance.length} registros de check-in`
              }
            />
            <KpiCard
              label="Tasa de aprobación"
              value={formatPct(passRate)}
              hint={
                exams.length === 0
                  ? "Sin exámenes cargados"
                  : pendingExams > 0
                    ? `${pendingExams} pendientes de corrección`
                    : "Todos corregidos"
              }
            />
            <KpiCard
              label="Tasa de certificación"
              value={formatPct(certRate)}
              hint={
                students.length === 0
                  ? "Sin estudiantes"
                  : `${uniqueCertifiedCount(certs)} de ${students.length} certificados`
              }
            />
          </div>

          <Panel title="Salud por generación">
            {cohortRows.length === 0 ? (
              <EmptyState
                title="Sin generaciones creadas"
                hint="Andá a Generaciones y creá la primera para arrancar el trackeo."
              />
            ) : (
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 12,
                }}
              >
                <thead>
                  <tr>
                    <th style={thStyle}>Generación</th>
                    <th style={thStyle}>Proyecto</th>
                    <th style={thStyle}>Estado</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>
                      Inscriptos
                    </th>
                    <th style={{ ...thStyle, textAlign: "right" }}>
                      Completados
                    </th>
                    <th style={{ ...thStyle, textAlign: "right" }}>
                      Asistencia
                    </th>
                    <th style={{ ...thStyle, textAlign: "right" }}>
                      Aprobación
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {cohortRows.map((r) => (
                    <tr
                      key={r.id}
                      style={{
                        borderTop: "1px solid var(--kg-border-subtle)",
                      }}
                    >
                      <td
                        style={{
                          ...tdStyle,
                          color: "var(--kg-text-1)",
                          fontWeight: 600,
                        }}
                      >
                        <Link
                          href={`/academia/cohortes/${r.id}`}
                          className="kg-focus"
                          style={{
                            color: "inherit",
                            textDecoration: "none",
                          }}
                        >
                          {r.name}
                        </Link>
                      </td>
                      <td style={tdStyle}>{r.projectName}</td>
                      <td style={tdStyle}>
                        <StatusPill
                          text={COHORT_LABEL[r.status]}
                          tone={COHORT_TONE[r.status]}
                        />
                      </td>
                      <td style={{ ...tdStyle, ...numStyle }}>
                        {r.enrolled === 0 ? (
                          <span style={{ color: "var(--kg-text-3)" }}>—</span>
                        ) : (
                          r.enrolled
                        )}
                      </td>
                      <td style={{ ...tdStyle, ...numStyle }}>
                        {r.enrolled === 0 ? (
                          <span style={{ color: "var(--kg-text-3)" }}>—</span>
                        ) : (
                          `${r.completed}/${r.enrolled}`
                        )}
                      </td>
                      <td style={{ ...tdStyle, ...numStyle }}>
                        {formatPct(r.attendancePct)}
                      </td>
                      <td style={{ ...tdStyle, ...numStyle }}>
                        {formatPct(r.passPct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
}: {
  readonly label: string;
  readonly value: string;
  readonly hint: string;
}) {
  return (
    <div
      className="kg-glass"
      style={{
        borderRadius: "var(--kg-r-16)",
        padding: "16px 18px",
        boxShadow: "var(--kg-shadow-amb)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        className="kg-t7"
        style={{
          color: "var(--kg-text-3)",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 0.3,
        }}
      >
        {label}
      </div>
      <div
        style={{
          color: "var(--kg-text-1)",
          fontSize: 26,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
        {hint}
      </div>
    </div>
  );
}

function formatPct(v: number | null): string {
  if (v == null) return "—";
  // Redondeo a 1 decimal salvo que sea entero.
  const rounded = Math.round(v * 10) / 10;
  if (Number.isInteger(rounded)) return `${rounded}%`;
  return `${rounded.toFixed(1)}%`;
}

function countByStatus<T extends { status: string }>(
  rows: readonly T[],
  status: string,
): number {
  return rows.reduce((n, r) => (r.status === status ? n + 1 : n), 0);
}

function uniqueCertifiedCount(
  certs: readonly { student_id: string }[],
): number {
  return new Set(certs.map((c) => c.student_id)).size;
}

const thStyle: React.CSSProperties = {
  padding: "8px 12px 8px 0",
  textAlign: "left",
  color: "var(--kg-text-3)",
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: 0.3,
  borderBottom: "1px solid var(--kg-border-subtle)",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 12px 10px 0",
  color: "var(--kg-text-2)",
  fontSize: 12,
};

const numStyle: React.CSSProperties = {
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};
