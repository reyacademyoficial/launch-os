import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ContextBar } from "@/components/kg/context-bar";
import { IconAca } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { StatusPill } from "@/components/kg/status-pill";
import {
  getActiveCourses,
  getActiveSystems,
  getAllProducts,
  getPropiaProjects,
} from "@/lib/academia/reference";
import { createClient } from "@/lib/supabase/server";

import type {
  CohortInitial,
  CourseOptionForCohort,
  ProjectOptionForCohort,
  SystemOptionForCohort,
} from "../cohort-form-drawer";
import { EditCohortButton } from "./edit-cohort-button";
import { ExportAttendanceButton } from "./export-attendance-button";
import type { BulkEnrollCandidate } from "./bulk-enroll-drawer";
import type {
  SaleOptionForEnroll,
  StudentOptionForEnroll,
} from "./enroll-student-drawer";
import {
  EnrollmentsPanel,
  type EnrollmentRowData,
} from "./enrollments-panel";
import {
  ClassesPanel,
  type AttendanceMapForClass,
  type ClassRowData,
  type EnrolledStudentForAttendance,
} from "./classes/classes-panel";
import type { StudentOptionForExam } from "./exams/exam-form-drawer";
import { ExamsPanel, type ExamRowData } from "./exams/exams-panel";

export const metadata: Metadata = { title: "Generación · Academia" };

type CohortStatus = "planned" | "active" | "finished" | "cancelled";
type EnrollmentStatus =
  | "active"
  | "completed"
  | "dropped"
  | "suspended"
  | "expired";

interface CohortDbRow {
  readonly id: string;
  readonly project_id: string;
  readonly course_id: string | null;
  readonly system_id: string | null;
  readonly name: string;
  readonly start_date: string;
  readonly end_date: string;
  readonly status: CohortStatus;
  readonly notes: string | null;
}

interface ProjectDbRow {
  readonly id: string;
  readonly name: string;
  readonly ownership: string;
}

interface CourseDbRow {
  readonly id: string;
  readonly product_id: string;
  readonly project_id: string;
  readonly active: boolean;
  readonly has_systems: boolean;
}

interface SystemDbRow {
  readonly id: string;
  readonly course_id: string;
  readonly name: string;
  readonly active: boolean;
}

interface ProductDbRow {
  readonly id: string;
  readonly name: string;
}

interface EnrollmentDbRow {
  readonly id: string;
  readonly student_id: string;
  readonly sale_id: string | null;
  readonly enrolled_at: string;
  readonly access_expires_at: string | null;
  readonly status: EnrollmentStatus;
  readonly progress_percent: number;
  readonly notes: string | null;
}

interface StudentDbRow {
  readonly id: string;
  readonly project_id: string;
  readonly name: string;
  readonly email: string | null;
  readonly status: "active" | "inactive" | "graduated";
}

interface SaleDbRow {
  readonly id: string;
  readonly product_id: string;
  readonly lead_id: string | null;
  readonly total_amount: number | string;
  readonly currency: string | null;
  readonly created_at: string;
}

interface SaleWithLead extends SaleDbRow {
  readonly leads:
    | { id: string; name: string | null }
    | { id: string; name: string | null }[]
    | null;
}

interface LeadDbRow {
  readonly id: string;
  readonly name: string | null;
}

interface ClassDbRow {
  readonly id: string;
  readonly scheduled_at: string;
  readonly topic: string | null;
  readonly notes: string | null;
}

interface AttendanceDbRow {
  readonly class_id: string;
  readonly student_id: string;
  readonly present: boolean;
}

interface ExamDbRow {
  readonly id: string;
  readonly student_id: string;
  readonly title: string;
  readonly taken_at: string;
  readonly score: number | string | null;
  readonly passed: boolean | null;
  readonly notes: string | null;
}

const STATUS_LABEL: Record<CohortStatus, string> = {
  planned: "Planeada",
  active: "Activa",
  finished: "Terminada",
  cancelled: "Cancelada",
};

const STATUS_TONE: Record<CohortStatus, string> = {
  planned: "var(--kg-neutral-500)",
  active: "var(--kg-positive-500)",
  finished: "var(--kg-accent-500)",
  cancelled: "var(--kg-negative-500)",
};

export default async function CohortFichaPage({
  params,
}: {
  readonly params: Promise<{ cohortId: string }>;
}) {
  const { cohortId } = await params;

  const supabase = await createClient();

  // ── Round-trip 1: cohort + queries scoped al cohortId + refs cacheados ─
  const [
    cohortRes,
    enrollmentsRes,
    classesRes,
    examsRes,
    propiaProjects,
    activeCourses,
    allProducts,
    activeSystems,
  ] = await Promise.all([
    supabase
      .from("cohorts")
      .select(
        "id, project_id, course_id, system_id, name, start_date, end_date, status, notes",
      )
      .eq("id", cohortId)
      .maybeSingle(),
    supabase
      .from("enrollments")
      .select(
        "id, student_id, sale_id, enrolled_at, access_expires_at, status, progress_percent, notes",
      )
      .eq("cohort_id", cohortId)
      .order("enrolled_at", { ascending: false }),
    supabase
      .from("classes")
      .select("id, scheduled_at, topic, notes")
      .eq("cohort_id", cohortId)
      .order("scheduled_at", { ascending: false }),
    supabase
      .from("exams")
      .select("id, student_id, title, taken_at, score, passed, notes")
      .eq("cohort_id", cohortId)
      .order("taken_at", { ascending: false }),
    getPropiaProjects(),
    getActiveCourses(),
    getAllProducts(),
    getActiveSystems(),
  ]);

  const cohort = cohortRes.data as CohortDbRow | null;
  if (!cohort) notFound();

  const enrollmentRows =
    (enrollmentsRes.data ?? []) as unknown as EnrollmentDbRow[];
  const classRows = (classesRes.data ?? []) as unknown as ClassDbRow[];
  const examRows = (examsRes.data ?? []) as unknown as ExamDbRow[];

  const productNameById = new Map<string, string>();
  for (const p of allProducts) productNameById.set(p.id, p.name);
  const courseNameById = new Map<string, string>();
  for (const c of activeCourses) {
    courseNameById.set(c.id, productNameById.get(c.product_id) ?? "—");
  }
  const projectName =
    propiaProjects.find((p) => p.id === cohort.project_id)?.name ?? null;
  const courseName = cohort.course_id
    ? courseNameById.get(cohort.course_id) ?? null
    : null;

  // ── Round-trip 2: todo lo que depende de cohort/classes en paralelo ────
  //
  //   1. projectStudents — todos los del proyecto (activos/inactivos).
  //   2. cohortSales     — sales del producto del curso, con leads embed
  //                        (evita un round-trip separado por leads).
  //   3. attendance      — asistencias de todas las clases de esta cohort.
  //   4. projectEnrollments — conteo de otras cohorts por alumno del
  //                        proyecto, via inner-join sobre students.
  //
  // No hay round-trip 3: leads viene embed en sales, systems se resuelve
  // desde el cache de activeSystems.

  const cohortCourseProductId = cohort.course_id
    ? activeCourses.find((c) => c.id === cohort.course_id)?.product_id ?? null
    : null;

  const classIds = classRows.map((c) => c.id);

  const [
    projectStudentsRes,
    salesRes,
    attendanceRes,
    projectEnrollmentsRes,
  ] = await Promise.all([
    supabase
      .from("students")
      .select("id, name, email, status")
      .eq("project_id", cohort.project_id)
      .order("name", { ascending: true }),
    cohortCourseProductId
      ? supabase
          .from("sales")
          .select(
            "id, product_id, lead_id, total_amount, currency, created_at, leads(id, name)",
          )
          .eq("product_id", cohortCourseProductId)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as SaleWithLead[] }),
    classIds.length === 0
      ? Promise.resolve({ data: [] as AttendanceDbRow[] })
      : supabase
          .from("attendance")
          .select("class_id, student_id, present")
          .in("class_id", classIds),
    supabase
      .from("enrollments")
      .select("student_id, students!inner(project_id)")
      .eq("students.project_id", cohort.project_id),
  ]);

  const projectStudents = (projectStudentsRes.data ?? []) as unknown as {
    id: string;
    name: string;
    email: string | null;
    status: "active" | "inactive" | "graduated";
  }[];
  const cohortSalesWithLeads =
    (salesRes.data ?? []) as unknown as SaleWithLead[];
  const attendanceRows =
    (attendanceRes.data ?? []) as unknown as AttendanceDbRow[];

  const studentNameById = new Map<string, string>();
  for (const s of projectStudents) studentNameById.set(s.id, s.name);
  const activeStudents = projectStudents.filter((s) => s.status === "active");

  const enrollmentCountByStudent = new Map<string, number>();
  for (const e of (projectEnrollmentsRes.data ?? []) as unknown as {
    student_id: string;
  }[]) {
    enrollmentCountByStudent.set(
      e.student_id,
      (enrollmentCountByStudent.get(e.student_id) ?? 0) + 1,
    );
  }

  // Bulk candidates: students del proyecto NO inscriptos aún en ESTA
  // cohort. Los ya inscriptos en otras cohorts sí pueden entrar acá.
  const alreadyEnrolledIds = new Set(enrollmentRows.map((e) => e.student_id));
  const bulkCandidates: BulkEnrollCandidate[] = projectStudents
    .filter((s) => !alreadyEnrolledIds.has(s.id))
    .map((s) => ({
      studentId: s.id,
      studentName: s.name,
      studentEmail: s.email,
      currentEnrollments: enrollmentCountByStudent.get(s.id) ?? 0,
    }));

  // Split del embed leads: extraer el nombre y quedar con la fila de sale.
  const cohortSales: SaleDbRow[] = cohortSalesWithLeads.map((s) => ({
    id: s.id,
    product_id: s.product_id,
    lead_id: s.lead_id,
    total_amount: s.total_amount,
    currency: s.currency,
    created_at: s.created_at,
  }));
  const leadNameById = new Map<string, string>();
  for (const s of cohortSalesWithLeads) {
    const lead = Array.isArray(s.leads) ? s.leads[0] : s.leads;
    if (lead && s.lead_id && lead.name) {
      leadNameById.set(s.lead_id, lead.name);
    }
  }

  // Sales ya vinculadas a algún enrollment de esta cohort — filtrar del
  // dropdown de vinculación (una sale no puede ligarse a dos enrollments).
  const alreadyLinkedSaleIds = new Set(
    enrollmentRows
      .map((e) => e.sale_id)
      .filter((v): v is string => v != null),
  );

  const projectOptions: ProjectOptionForCohort[] = propiaProjects
    .map((p) => ({ id: p.id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const courseOptions: CourseOptionForCohort[] = activeCourses
    .map((c) => ({
      id: c.id,
      productName: productNameById.get(c.product_id) ?? "—",
      projectId: c.project_id,
      hasSystems: c.has_systems,
    }))
    .sort((a, b) => a.productName.localeCompare(b.productName));

  // Sistemas del curso actual — para el selector nullable en el edit drawer.
  // activeSystems ya viene cacheado; filtrar en memoria por el curso actual.
  const systemsForCourse = cohort.course_id
    ? activeSystems.filter((s) => s.course_id === cohort.course_id)
    : [];
  const systemOptions: SystemOptionForCohort[] = systemsForCourse
    .map((s) => ({ id: s.id, name: s.name, courseId: s.course_id }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const currentSystemName = cohort.system_id
    ? systemsForCourse.find((s) => s.id === cohort.system_id)?.name ?? null
    : null;
  const currentCourseHasSystems = cohort.course_id
    ? activeCourses.find((c) => c.id === cohort.course_id)?.has_systems ??
      false
    : false;

  const initial: CohortInitial = {
    id: cohort.id,
    projectId: cohort.project_id,
    courseId: cohort.course_id,
    systemId: cohort.system_id,
    name: cohort.name,
    startDate: cohort.start_date,
    endDate: cohort.end_date,
    status: cohort.status,
    notes: cohort.notes,
  };

  // Options para el drawer de inscribir.
  const availableStudents: StudentOptionForEnroll[] = activeStudents.map(
    (s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
    }),
  );
  const availableSales: SaleOptionForEnroll[] = cohortSales
    .filter((s) => !alreadyLinkedSaleIds.has(s.id))
    .map((s) => ({
      id: s.id,
      leadName: s.lead_id ? leadNameById.get(s.lead_id) ?? "—" : "—",
      amount: Number(s.total_amount),
      currency: s.currency === "USD" ? "USD" : "ARS",
      createdAt: s.created_at,
    }));

  const enrollments: EnrollmentRowData[] = enrollmentRows.map((e) => ({
    id: e.id,
    studentId: e.student_id,
    studentName: studentNameById.get(e.student_id) ?? "—",
    saleId: e.sale_id,
    enrolledAt: e.enrolled_at,
    accessExpiresAt: e.access_expires_at,
    status: e.status,
    progressPercent: e.progress_percent,
    notes: e.notes,
  }));

  const classesCount = classRows.length;
  const examsCount = examRows.length;

  // Attendance ya se trajo en el round-trip 2. Contar presentes por clase.
  const presentCountByClass = new Map<string, number>();
  const attendanceByClass: Record<
    string,
    Array<{ studentId: string; present: boolean }>
  > = {};
  for (const a of attendanceRows) {
    if (a.present) {
      presentCountByClass.set(
        a.class_id,
        (presentCountByClass.get(a.class_id) ?? 0) + 1,
      );
    }
    const bucket = attendanceByClass[a.class_id] ?? [];
    bucket.push({ studentId: a.student_id, present: a.present });
    attendanceByClass[a.class_id] = bucket;
  }

  const classesForPanel: ClassRowData[] = classRows.map((c) => ({
    id: c.id,
    scheduledAtIso: c.scheduled_at,
    topic: c.topic,
    notes: c.notes,
    presentCount: presentCountByClass.get(c.id) ?? 0,
  }));

  // Inscriptos vigentes (active/completed) para la matriz de asistencia.
  // Los dropped/suspended salen — ya no vienen a clase.
  const enrolledStudentsForAttendance: EnrolledStudentForAttendance[] =
    enrollmentRows
      .filter((e) => e.status === "active" || e.status === "completed")
      .map((e) => ({
        studentId: e.student_id,
        studentName: studentNameById.get(e.student_id) ?? "—",
      }))
      .sort((a, b) => a.studentName.localeCompare(b.studentName));

  const attendanceMap: AttendanceMapForClass = attendanceByClass;

  // Exams: shape para el panel. El score viene como string por la
  // representación numeric(5,2) en postgrest — convertimos a number para
  // la UI (null-safe).
  const examsForPanel: ExamRowData[] = examRows.map((e) => ({
    id: e.id,
    studentId: e.student_id,
    studentName: studentNameById.get(e.student_id) ?? "—",
    title: e.title,
    takenAt: e.taken_at,
    score: e.score == null ? null : Number(e.score),
    passed: e.passed,
    notes: e.notes,
  }));

  // Options de estudiantes para el drawer de examen: TODOS los inscriptos
  // (incluidos dropped/suspended) — un dropped puede tener un examen
  // histórico rendido antes de irse.
  const examStudentOptions: StudentOptionForExam[] = enrollmentRows
    .map((e) => ({
      studentId: e.student_id,
      studentName: studentNameById.get(e.student_id) ?? "—",
    }))
    .sort((a, b) => a.studentName.localeCompare(b.studentName));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconAca size={16} />}
        title={cohort.name}
        stats={[
          { l: "Estado", v: STATUS_LABEL[cohort.status] },
          { l: "Inscriptos", v: String(enrollments.length) },
          { l: "Clases", v: String(classesCount) },
          { l: "Exámenes", v: String(examsCount) },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Panel title="Datos de la generación">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <FieldRow label="Proyecto" value={projectName ?? "—"} />
            <FieldRow label="Curso" value={courseName ?? "Sin curso"} />
            {currentCourseHasSystems && (
              <FieldRow
                label="Sistema"
                value={currentSystemName ?? "Sin sistema"}
              />
            )}
            <FieldRow
              label="Período"
              value={`${formatDate(cohort.start_date)} – ${formatDate(cohort.end_date)}`}
            />
            <FieldRow
              label="Estado"
              value={
                <StatusPill
                  text={STATUS_LABEL[cohort.status]}
                  tone={STATUS_TONE[cohort.status]}
                />
              }
            />
            {cohort.notes && (
              <FieldRow label="Notas" value={cohort.notes} multiline />
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
                href="/academia/cohortes"
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
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <ExportAttendanceButton cohortId={cohort.id} />
                <EditCohortButton
                  projects={projectOptions}
                  courses={courseOptions}
                  systems={systemOptions}
                  initial={initial}
                />
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Inscriptos">
          <EnrollmentsPanel
            cohortId={cohort.id}
            cohortName={cohort.name}
            cohortHasCourse={cohort.course_id != null}
            enrollments={enrollments}
            availableStudents={availableStudents}
            availableSales={availableSales}
            bulkCandidates={bulkCandidates}
          />
        </Panel>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 16,
        }}
      >
        <Panel title="Clases">
          <ClassesPanel
            cohortId={cohort.id}
            cohortName={cohort.name}
            classes={classesForPanel}
            enrolledStudents={enrolledStudentsForAttendance}
            attendanceByClass={attendanceMap}
          />
        </Panel>
        <Panel title="Exámenes">
          <ExamsPanel
            cohortId={cohort.id}
            cohortName={cohort.name}
            exams={examsForPanel}
            studentOptions={examStudentOptions}
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
    return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return ymd.slice(0, 10);
  }
}
