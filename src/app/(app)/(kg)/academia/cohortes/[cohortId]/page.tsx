import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ContextBar } from "@/components/kg/context-bar";
import { IconAca } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { StatusPill } from "@/components/kg/status-pill";
import { createClient } from "@/lib/supabase/server";

import type {
  CohortInitial,
  CourseOptionForCohort,
  ProjectOptionForCohort,
} from "../cohort-form-drawer";
import { EditCohortButton } from "./edit-cohort-button";
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
type EnrollmentStatus = "active" | "completed" | "dropped" | "suspended";

interface CohortDbRow {
  readonly id: string;
  readonly project_id: string;
  readonly course_id: string | null;
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

  const [
    cohortRes,
    projectsRes,
    coursesRes,
    productsRes,
    enrollmentsRes,
    classesRes,
    examsRes,
  ] = await Promise.all([
    supabase
      .from("cohorts")
      .select(
        "id, project_id, course_id, name, start_date, end_date, status, notes",
      )
      .eq("id", cohortId)
      .maybeSingle(),
    supabase
      .from("projects")
      .select("id, name, ownership")
      .eq("ownership", "propia"),
    supabase
      .from("courses")
      .select("id, product_id, project_id, active")
      .eq("active", true),
    supabase.from("products").select("id, name"),
    supabase
      .from("enrollments")
      .select(
        "id, student_id, sale_id, enrolled_at, status, progress_percent, notes",
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
  ]);

  const cohort = cohortRes.data as CohortDbRow | null;
  if (!cohort) notFound();

  const propiaProjects =
    (projectsRes.data ?? []) as unknown as ProjectDbRow[];
  const activeCourses =
    (coursesRes.data ?? []) as unknown as CourseDbRow[];
  const allProducts = (productsRes.data ?? []) as unknown as ProductDbRow[];
  const enrollmentRows =
    (enrollmentsRes.data ?? []) as unknown as EnrollmentDbRow[];

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

  // Segundo batch: students del proyecto de la cohort (para el dropdown de
  // inscribir) + sales del mismo producto que el curso (para el vínculo
  // opcional). El vínculo solo aplica si la cohort tiene curso.
  const [studentsRes, salesRes] = await Promise.all([
    supabase
      .from("students")
      .select("id, project_id, name, email, status")
      .eq("project_id", cohort.project_id)
      .eq("status", "active")
      .order("name", { ascending: true }),
    cohort.course_id
      ? (async () => {
          const course = activeCourses.find((c) => c.id === cohort.course_id);
          if (!course) return { data: [] as SaleDbRow[] };
          return supabase
            .from("sales")
            .select(
              "id, product_id, lead_id, total_amount, currency, created_at",
            )
            .eq("product_id", course.product_id)
            .order("created_at", { ascending: false });
        })()
      : Promise.resolve({ data: [] as SaleDbRow[] }),
  ]);

  const activeStudents =
    (studentsRes.data ?? []) as unknown as StudentDbRow[];
  const cohortSales = (salesRes.data ?? []) as unknown as SaleDbRow[];

  const studentNameById = new Map<string, string>();
  for (const s of activeStudents) studentNameById.set(s.id, s.name);

  // Fetch todos los student names (incluye inactivos) para poder mostrar
  // en la tabla el nombre del student aunque haya cambiado a inactivo
  // después de inscribirse. Bounded a project_id.
  const allStudentsResExtra = await supabase
    .from("students")
    .select("id, name")
    .eq("project_id", cohort.project_id);
  for (const s of (allStudentsResExtra.data ?? []) as unknown as {
    id: string;
    name: string;
  }[]) {
    studentNameById.set(s.id, s.name);
  }

  // Leads para las sales.
  const leadIds = Array.from(
    new Set(cohortSales.map((s) => s.lead_id).filter((v): v is string => v != null)),
  );
  const leadsRes =
    leadIds.length === 0
      ? { data: [] as LeadDbRow[] }
      : await supabase.from("leads").select("id, name").in("id", leadIds);
  const leadNameById = new Map<string, string>();
  for (const l of (leadsRes.data ?? []) as unknown as LeadDbRow[]) {
    if (l.name) leadNameById.set(l.id, l.name);
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
    }))
    .sort((a, b) => a.productName.localeCompare(b.productName));

  const initial: CohortInitial = {
    id: cohort.id,
    projectId: cohort.project_id,
    courseId: cohort.course_id,
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
    status: e.status,
    progressPercent: e.progress_percent,
    notes: e.notes,
  }));

  const classRows = (classesRes.data ?? []) as unknown as ClassDbRow[];
  const classesCount = classRows.length;
  const examRows = (examsRes.data ?? []) as unknown as ExamDbRow[];
  const examsCount = examRows.length;

  // Attendance batch: para todas las clases de esta cohort, para poder
  // contar presentes por clase y precargar la matriz al abrir el drawer.
  const classIds = classRows.map((c) => c.id);
  const attendanceRes =
    classIds.length === 0
      ? { data: [] as AttendanceDbRow[] }
      : await supabase
          .from("attendance")
          .select("class_id, student_id, present")
          .in("class_id", classIds);
  const attendanceRows =
    (attendanceRes.data ?? []) as unknown as AttendanceDbRow[];

  // Presentes por clase.
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

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2fr)",
          gap: 16,
        }}
      >
        <Panel title="Datos de la generación">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <FieldRow label="Proyecto" value={projectName ?? "—"} />
            <FieldRow label="Curso" value={courseName ?? "Sin curso"} />
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
              <EditCohortButton
                projects={projectOptions}
                courses={courseOptions}
                initial={initial}
              />
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
