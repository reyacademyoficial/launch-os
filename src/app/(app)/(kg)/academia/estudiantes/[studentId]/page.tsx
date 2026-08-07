import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ContextBar } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import { IconAca } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { StatusPill } from "@/components/kg/status-pill";
import { createClient } from "@/lib/supabase/server";

import type { CourseOptionForCert } from "../../certificados/certificate-form-drawer";
import type {
  ProjectOptionForStudent,
  StudentInitial,
} from "../student-form-drawer";
import { EditStudentButton } from "./edit-student-button";
import {
  StudentCertificatesPanel,
  type StudentCertRowData,
} from "./student-certificates-panel";

export const metadata: Metadata = { title: "Estudiante · Academia" };

type Status = "active" | "inactive" | "graduated";

interface StudentDbRow {
  readonly id: string;
  readonly project_id: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly status: Status;
  readonly notes: string | null;
  readonly enrolled_at: string;
}

interface ProjectDbRow {
  readonly id: string;
  readonly name: string;
  readonly ownership: string;
}

type EnrollStatus = "active" | "completed" | "dropped" | "suspended";

interface EnrollmentBrief {
  readonly id: string;
  readonly cohort_id: string;
  readonly sale_id: string | null;
  readonly enrolled_at: string;
  readonly status: EnrollStatus;
  readonly progress_percent: number;
}

interface CertBriefDbRow {
  readonly id: string;
  readonly course_id: string;
  readonly code: string | null;
  readonly issued_at: string;
  readonly url: string | null;
  readonly notes: string | null;
}

interface CourseBriefDbRow {
  readonly id: string;
  readonly product_id: string;
  readonly project_id: string;
}

interface ProductBriefDbRow {
  readonly id: string;
  readonly name: string;
}

const ENROLL_STATUS_LABEL: Record<EnrollStatus, string> = {
  active: "Activo",
  completed: "Completado",
  dropped: "Abandonó",
  suspended: "Suspendido",
};

const ENROLL_STATUS_TONE: Record<EnrollStatus, string> = {
  active: "var(--kg-positive-500)",
  completed: "var(--kg-accent-500)",
  dropped: "var(--kg-negative-500)",
  suspended: "var(--kg-warning-500)",
};

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

export default async function StudentFichaPage({
  params,
}: {
  readonly params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;

  const supabase = await createClient();

  const [
    studentRes,
    projectsRes,
    enrollmentsRes,
    attendanceRes,
    examsRes,
    certsRes,
    cohortsRes,
  ] = await Promise.all([
    supabase
      .from("students")
      .select(
        "id, project_id, name, email, phone, status, notes, enrolled_at",
      )
      .eq("id", studentId)
      .maybeSingle(),
    supabase
      .from("projects")
      .select("id, name, ownership")
      .eq("ownership", "propia"),
    supabase
      .from("enrollments")
      .select(
        "id, cohort_id, sale_id, enrolled_at, status, progress_percent",
      )
      .eq("student_id", studentId)
      .order("enrolled_at", { ascending: false }),
    supabase
      .from("attendance")
      .select("id", { count: "exact", head: true })
      .eq("student_id", studentId),
    supabase
      .from("exams")
      .select("id", { count: "exact", head: true })
      .eq("student_id", studentId),
    supabase
      .from("certificates")
      .select("id, course_id, code, issued_at, url, notes")
      .eq("student_id", studentId)
      .order("issued_at", { ascending: false }),
    supabase.from("cohorts").select("id, name"),
  ]);

  const student = studentRes.data as StudentDbRow | null;
  if (!student) notFound();

  const propiaProjects =
    (projectsRes.data ?? []) as unknown as ProjectDbRow[];
  const projectName =
    propiaProjects.find((p) => p.id === student.project_id)?.name ?? null;

  const projectOptions: ProjectOptionForStudent[] = propiaProjects
    .map((p) => ({ id: p.id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const initial: StudentInitial = {
    id: student.id,
    projectId: student.project_id,
    name: student.name,
    email: student.email,
    phone: student.phone,
    status: student.status,
    notes: student.notes,
  };

  const enrollmentRows =
    (enrollmentsRes.data ?? []) as unknown as EnrollmentBrief[];
  const cohortsData =
    (cohortsRes.data ?? []) as unknown as { id: string; name: string }[];
  const cohortNameById = new Map<string, string>();
  for (const c of cohortsData) cohortNameById.set(c.id, c.name);

  const attendanceCount = attendanceRes.count ?? 0;
  const examsCount = examsRes.count ?? 0;
  const certRows = (certsRes.data ?? []) as unknown as CertBriefDbRow[];
  const certsCount = certRows.length;

  // Courses del proyecto del student — para mostrar el nombre en la lista
  // y alimentar el drawer de emisión. Filtrado en server para no bombear
  // toda la tabla al cliente.
  const [studentCoursesRes, productsForCertsRes] = await Promise.all([
    supabase
      .from("courses")
      .select("id, product_id, project_id")
      .eq("project_id", student.project_id),
    supabase.from("products").select("id, name"),
  ]);
  const studentCourseRows =
    (studentCoursesRes.data ?? []) as unknown as CourseBriefDbRow[];
  const productRowsForCerts =
    (productsForCertsRes.data ?? []) as unknown as ProductBriefDbRow[];
  const productNameByIdForCerts = new Map<string, string>();
  for (const p of productRowsForCerts)
    productNameByIdForCerts.set(p.id, p.name);
  const courseNameById = new Map<string, string>();
  for (const c of studentCourseRows) {
    courseNameById.set(
      c.id,
      productNameByIdForCerts.get(c.product_id) ?? "—",
    );
  }

  const studentCerts: StudentCertRowData[] = certRows.map((c) => ({
    id: c.id,
    courseId: c.course_id,
    courseName: courseNameById.get(c.course_id) ?? "—",
    code: c.code,
    issuedAt: c.issued_at,
    url: c.url,
    notes: c.notes,
  }));

  const courseOptionsForCert: CourseOptionForCert[] = studentCourseRows.map(
    (c) => ({
      id: c.id,
      productName: productNameByIdForCerts.get(c.product_id) ?? "—",
      projectId: c.project_id,
    }),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconAca size={16} />}
        title={student.name}
        stats={[
          { l: "Estado", v: STATUS_LABEL[student.status] },
          { l: "Generaciones", v: String(enrollmentRows.length) },
          { l: "Asistencias", v: String(attendanceCount) },
          { l: "Certificados", v: String(certsCount) },
        ]}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2fr)",
          gap: 16,
        }}
      >
        <Panel title="Datos del estudiante">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <FieldRow label="Proyecto" value={projectName ?? "—"} />
            <FieldRow label="Email" value={student.email ?? "—"} />
            <FieldRow label="Teléfono" value={student.phone ?? "—"} />
            <FieldRow
              label="Estado"
              value={
                <StatusPill
                  text={STATUS_LABEL[student.status]}
                  tone={STATUS_TONE[student.status]}
                />
              }
            />
            <FieldRow
              label="Alta"
              value={formatDate(student.enrolled_at)}
            />
            {student.notes && (
              <FieldRow label="Notas" value={student.notes} multiline />
            )}
            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 6,
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Link
                href="/academia/estudiantes"
                className="kg-focus"
                style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  background: "transparent",
                  border: "1px solid var(--kg-border-subtle)",
                  color: "var(--kg-text-2)",
                  fontSize: 11,
                  fontWeight: 700,
                  textDecoration: "none",
                }}
              >
                ← Volver
              </Link>
              <EditStudentButton
                projects={projectOptions}
                initial={initial}
              />
            </div>
          </div>
        </Panel>

        <Panel title="Generaciones">
          {enrollmentRows.length === 0 ? (
            <EmptyState
              icon={<IconAca size={22} />}
              title="Sin generaciones asignadas"
              hint="Este estudiante todavía no está inscripto en ninguna generación. Andá a la ficha de la generación (Generaciones → nombre) y usá 'Inscribir' desde allí."
            />
          ) : (
            <div
              style={{ display: "flex", flexDirection: "column", gap: 6 }}
            >
              {enrollmentRows.map((e) => (
                <div
                  key={e.id}
                  style={{
                    padding: "10px 14px",
                    borderRadius: "var(--kg-r-8)",
                    background: "var(--kg-surface-2-solid)",
                    border: "1px solid var(--kg-border-subtle)",
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 12,
                    alignItems: "center",
                  }}
                >
                  <div>
                    <Link
                      href={`/academia/cohortes/${e.cohort_id}`}
                      className="kg-focus"
                      style={{
                        color: "var(--kg-text-1)",
                        textDecoration: "none",
                        fontWeight: 600,
                        fontSize: 13,
                      }}
                    >
                      {cohortNameById.get(e.cohort_id) ?? "—"}
                    </Link>
                    <div
                      className="kg-t7"
                      style={{
                        color: "var(--kg-text-3)",
                        marginTop: 2,
                        display: "flex",
                        gap: 10,
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <span>desde {formatDate(e.enrolled_at)}</span>
                      {e.sale_id && (
                        <span
                          style={{
                            padding: "1px 6px",
                            borderRadius: 4,
                            background: "var(--kg-surface-1-solid)",
                            color: "var(--kg-accent-text)",
                            fontSize: 10,
                            fontWeight: 700,
                          }}
                        >
                          Auto
                        </span>
                      )}
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      alignItems: "flex-end",
                    }}
                  >
                    <StatusPill
                      text={ENROLL_STATUS_LABEL[e.status]}
                      tone={ENROLL_STATUS_TONE[e.status]}
                    />
                    <div
                      className="kg-t7"
                      style={{
                        color: "var(--kg-text-3)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {e.progress_percent}%
                    </div>
                  </div>
                </div>
              ))}
              <div
                className="kg-t7"
                style={{
                  color: "var(--kg-text-3)",
                  marginTop: 4,
                  padding: "0 2px",
                  fontStyle: "italic",
                }}
              >
                Editar o quitar inscripciones se hace desde la ficha de
                cada generación.
              </div>
            </div>
          )}
        </Panel>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 16,
        }}
      >
        <Panel title="Asistencia">
          <EmptyState
            icon={<IconAca size={22} />}
            title="Sub-sección en construcción"
            hint={`${attendanceCount} registros de asistencia — se muestran por generación cuando conectemos la sub-sección.`}
          />
        </Panel>
        <Panel title="Exámenes">
          <EmptyState
            icon={<IconAca size={22} />}
            title="Sub-sección en construcción"
            hint={`${examsCount} exámenes — score, passed, taken_at, por generación.`}
          />
        </Panel>
        <Panel title="Certificados">
          <StudentCertificatesPanel
            studentId={student.id}
            studentName={student.name}
            studentProjectId={student.project_id}
            studentProjectName={projectName ?? "—"}
            certificates={studentCerts}
            courses={courseOptionsForCert}
          />
        </Panel>
      </div>
    </div>
  );
}

function FieldRow({
  label,
  value,
  multiline,
}: {
  readonly label: string;
  readonly value: React.ReactNode;
  readonly multiline?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div
        className="kg-t7"
        style={{ color: "var(--kg-text-3)", fontWeight: 600 }}
      >
        {label}
      </div>
      <div
        style={{
          color: "var(--kg-text-1)",
          fontSize: 13,
          lineHeight: multiline ? 1.55 : 1.4,
          whiteSpace: multiline ? "pre-wrap" : "normal",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function formatDate(ymd: string): string {
  try {
    const d = ymd.length === 10 ? new Date(`${ymd}T12:00:00Z`) : new Date(ymd);
    return d.toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return ymd.slice(0, 10);
  }
}
