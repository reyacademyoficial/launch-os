import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ContextBar } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import { IconAca } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { StatusPill } from "@/components/kg/status-pill";
import type { ParameterType } from "@/lib/academia/parameters";
import { getSessionProfile, userCanEditProject } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

import type { CourseOptionForCert } from "../../certificados/certificate-form-drawer";
import type {
  ProjectOptionForStudent,
  StudentInitial,
} from "../student-form-drawer";
import { EditStudentButton } from "./edit-student-button";
import {
  EnrollmentCard,
  type EnrollmentCardData,
  type EnrollmentCardModule,
  type EnrollmentCardParameter,
} from "./enrollment-card";
import {
  StudentCertificatesPanel,
  type StudentCertRowData,
} from "./student-certificates-panel";

export const metadata: Metadata = { title: "Estudiante · Academia" };

// ═══════════════════════════════════════════════════════════════════════════
// Ficha del alumno — Fase H · task #1 (vista unificada).
//
// Orden por importancia:
//   1) Header (ContextBar) + Panel "Datos del estudiante"
//   2) Panel "Generaciones": 1 card por enrollment con TODA la info del curso
//      (nombre, cohort, sistema, progreso, badge de vencimiento, botón "Dar
//      de baja ahora", parámetros del curso inline, módulos completados/
//      pendientes inline). Empty state claro si no hay enrollments.
//   3) Panel "Certificados"
//   4) Panel "Exámenes" (placeholder)
//
// Los paneles sueltos de Progreso módulos / Parámetros / Vigencia que había
// antes se movieron DENTRO del card del enrollment correspondiente.
// ═══════════════════════════════════════════════════════════════════════════

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

type EnrollStatus =
  | "active"
  | "completed"
  | "dropped"
  | "suspended"
  | "expired";

interface EnrollmentBrief {
  readonly id: string;
  readonly cohort_id: string;
  readonly sale_id: string | null;
  readonly enrolled_at: string;
  readonly status: EnrollStatus;
  readonly progress_percent: number;
  readonly access_expires_at: string | null;
  readonly notes: string | null;
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
  readonly progress_source: string;
  readonly has_systems: boolean;
}

interface ProductBriefDbRow {
  readonly id: string;
  readonly name: string;
}

interface CohortWithSystemRow {
  readonly id: string;
  readonly name: string;
  readonly course_id: string | null;
  readonly system_id: string | null;
}

interface SystemNameRow {
  readonly id: string;
  readonly name: string;
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

export default async function StudentFichaPage({
  params,
}: {
  readonly params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;

  const supabase = await createClient();
  const profile = await getSessionProfile();
  const canExpire =
    profile != null &&
    (profile.role === "admin" ||
      profile.role === "coordinador" ||
      profile.role === "superadmin" ||
      profile.role === "dev" ||
      profile.isDevPrivileged);

  const [
    studentRes,
    projectsRes,
    enrollmentsRes,
    attendanceRes,
    examsRes,
    certsRes,
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
        "id, cohort_id, sale_id, enrolled_at, status, progress_percent, access_expires_at, notes",
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
    enrolledAt: student.enrolled_at,
    notes: student.notes,
  };

  const enrollmentRows =
    (enrollmentsRes.data ?? []) as unknown as EnrollmentBrief[];

  const attendanceCount = attendanceRes.count ?? 0;
  const examsCount = examsRes.count ?? 0;
  const certRows = (certsRes.data ?? []) as unknown as CertBriefDbRow[];
  const certsCount = certRows.length;

  // Cohortes de los enrollments del alumno — se traen aparte porque
  // necesitamos course_id + system_id (no viene con la select principal).
  const enrollmentCohortIds = enrollmentRows.map((e) => e.cohort_id);
  const cohortsRes =
    enrollmentCohortIds.length > 0
      ? await supabase
          .from("cohorts")
          .select("id, name, course_id, system_id")
          .in("id", enrollmentCohortIds)
      : { data: [] as unknown[] };
  const cohortsData =
    (cohortsRes.data ?? []) as unknown as CohortWithSystemRow[];
  const cohortById = new Map<string, CohortWithSystemRow>();
  for (const c of cohortsData) cohortById.set(c.id, c);

  // Systems: solo cargamos los referenciados por las cohortes del alumno.
  const systemIds = Array.from(
    new Set(
      cohortsData
        .map((c) => c.system_id)
        .filter((v): v is string => v != null),
    ),
  );
  const systemsRes =
    systemIds.length > 0
      ? await supabase
          .from("academia_systems")
          .select("id, name")
          .in("id", systemIds)
      : { data: [] as unknown[] };
  const systemsData = (systemsRes.data ?? []) as unknown as SystemNameRow[];
  const systemNameById = new Map<string, string>();
  for (const s of systemsData) systemNameById.set(s.id, s.name);

  // Courses del proyecto del student (para nombre + progress_source +
  // has_systems). Filtrado en server para no bombear toda la tabla al
  // cliente. Filtramos también por los course_id derivados de las cohortes,
  // pero el proyecto ya es un filtro fuerte.
  const [studentCoursesRes, productsForCertsRes] = await Promise.all([
    supabase
      .from("courses")
      .select("id, product_id, project_id, progress_source, has_systems")
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
  const courseByIdMap = new Map<string, CourseBriefDbRow>();
  for (const c of studentCourseRows) {
    courseNameById.set(
      c.id,
      productNameByIdForCerts.get(c.product_id) ?? "—",
    );
    courseByIdMap.set(c.id, c);
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

  // ── Parámetros por (course_id) ─────────────────────────────────────────
  const courseIdsForParams = Array.from(
    new Set(
      cohortsData
        .map((c) => c.course_id)
        .filter((v): v is string => v != null),
    ),
  );
  const [paramsRes, valuesRes] = await Promise.all([
    courseIdsForParams.length > 0
      ? supabase
          .from("course_parameters")
          .select("id, course_id, key, label, type, required, order_index")
          .in("course_id", courseIdsForParams)
          .order("order_index", { ascending: true })
      : Promise.resolve({ data: [] as unknown[] }),
    enrollmentRows.length > 0
      ? supabase
          .from("student_parameter_values")
          .select(
            "enrollment_id, parameter_id, value_bool, value_int, value_text",
          )
          .in(
            "enrollment_id",
            enrollmentRows.map((e) => e.id),
          )
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  interface ParamDbRow {
    readonly id: string;
    readonly course_id: string;
    readonly key: string;
    readonly label: string;
    readonly type: ParameterType;
    readonly required: boolean;
    readonly order_index: number;
  }
  interface ValueDbRow {
    readonly enrollment_id: string;
    readonly parameter_id: string;
    readonly value_bool: boolean | null;
    readonly value_int: number | null;
    readonly value_text: string | null;
  }
  const paramRows = (paramsRes.data ?? []) as unknown as ParamDbRow[];
  const valueRows = (valuesRes.data ?? []) as unknown as ValueDbRow[];

  const paramsByCourse = new Map<string, ParamDbRow[]>();
  for (const p of paramRows) {
    const arr = paramsByCourse.get(p.course_id) ?? [];
    arr.push(p);
    paramsByCourse.set(p.course_id, arr);
  }
  const valueByEnrollmentAndParam = new Map<string, ValueDbRow>();
  for (const v of valueRows) {
    valueByEnrollmentAndParam.set(`${v.enrollment_id}::${v.parameter_id}`, v);
  }

  // ── Módulos + progreso ─────────────────────────────────────────────────
  // Cargamos módulos de TODOS los cursos donde el student tiene enrollment.
  // El marcado puede ser automático (GHL sync) o manual desde la ficha —
  // no filtramos por progress_source: si hay módulos cargados, se muestran.
  const [modulesRes, progressRes] = await Promise.all([
    courseIdsForParams.length > 0
      ? supabase
          .from("course_modules")
          .select("id, course_id, name, order_index")
          .in("course_id", courseIdsForParams)
          .order("order_index", { ascending: true })
      : Promise.resolve({ data: [] as unknown[] }),
    enrollmentRows.length > 0
      ? supabase
          .from("student_module_progress")
          .select("enrollment_id, course_module_id, completed_at, source")
          .in(
            "enrollment_id",
            enrollmentRows.map((e) => e.id),
          )
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  interface ModuleDbRow {
    readonly id: string;
    readonly course_id: string;
    readonly name: string;
    readonly order_index: number;
  }
  interface ProgressDbRow {
    readonly enrollment_id: string;
    readonly course_module_id: string;
    readonly completed_at: string | null;
    readonly source: "ghl_tag" | "manual";
  }
  const moduleRowsForProgress =
    (modulesRes.data ?? []) as unknown as ModuleDbRow[];
  const progressRows =
    (progressRes.data ?? []) as unknown as ProgressDbRow[];

  const modulesByCourse = new Map<string, ModuleDbRow[]>();
  for (const m of moduleRowsForProgress) {
    const arr = modulesByCourse.get(m.course_id) ?? [];
    arr.push(m);
    modulesByCourse.set(m.course_id, arr);
  }
  const progressByEnrollmentAndModule = new Map<string, ProgressDbRow>();
  for (const p of progressRows) {
    progressByEnrollmentAndModule.set(
      `${p.enrollment_id}::${p.course_module_id}`,
      p,
    );
  }

  const canEditParameters = await userCanEditProject(student.project_id);
  // El toggle manual de módulos usa las mismas capabilities que parámetros.
  const canEditModules = canEditParameters;

  // ── Enrollment cards data ──────────────────────────────────────────────
  const enrollmentCards: EnrollmentCardData[] = enrollmentRows.map((e) => {
    const cohort = cohortById.get(e.cohort_id) ?? null;
    const courseId = cohort?.course_id ?? null;
    const course = courseId ? courseByIdMap.get(courseId) : null;
    const cohortLabel = cohort?.name ?? "generación";
    const courseLabel = courseId
      ? courseNameById.get(courseId) ?? "Curso"
      : "Sin curso";
    const systemName =
      cohort?.system_id != null && (course?.has_systems ?? false)
        ? systemNameById.get(cohort.system_id) ?? null
        : null;
    const progressSource = (course?.progress_source ?? "attendance") as
      | "attendance"
      | "ghl_tags"
      | "manual";

    const modulesForCourse = courseId
      ? modulesByCourse.get(courseId) ?? []
      : [];
    const modules: EnrollmentCardModule[] = modulesForCourse.map((m) => {
      const p = progressByEnrollmentAndModule.get(`${e.id}::${m.id}`);
      return {
        moduleId: m.id,
        moduleName: m.name,
        orderIndex: m.order_index,
        completedAt: p?.completed_at ?? null,
        source: p?.source ?? null,
      };
    });

    const paramsForCourse = courseId
      ? paramsByCourse.get(courseId) ?? []
      : [];
    const parameters: EnrollmentCardParameter[] = paramsForCourse.map((p) => {
      const value = valueByEnrollmentAndParam.get(`${e.id}::${p.id}`);
      let currentValue: boolean | number | string | null = null;
      if (value) {
        if (p.type === "boolean") currentValue = value.value_bool;
        else if (p.type === "integer") currentValue = value.value_int;
        else currentValue = value.value_text;
      }
      return {
        parameterId: p.id,
        key: p.key,
        label: p.label,
        type: p.type,
        required: p.required,
        currentValue,
      };
    });

    return {
      enrollmentId: e.id,
      cohortId: e.cohort_id,
      cohortName: cohortLabel,
      courseId,
      courseName: courseLabel,
      systemName,
      status: e.status,
      progressPercent: e.progress_percent,
      enrolledAt: e.enrolled_at,
      accessExpiresAt: e.access_expires_at,
      saleId: e.sale_id,
      notes: e.notes,
      studentName: student.name,
      studentEmail: student.email,
      progressSource,
      modules,
      parameters,
    };
  });

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

      <Panel title="Datos del estudiante">
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(160px, 1fr)) auto",
            gap: 14,
            alignItems: "start",
          }}
        >
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
          <FieldRow label="Alta" value={formatDate(student.enrolled_at)} />
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              alignSelf: "end",
              justifyContent: "flex-end",
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
        {student.notes && (
          <div style={{ marginTop: 12 }}>
            <FieldRow label="Notas" value={student.notes} multiline />
          </div>
        )}
      </Panel>

      <Panel title="Generaciones">
        {enrollmentCards.length === 0 ? (
          <EmptyState
            icon={<IconAca size={22} />}
            title="Sin generaciones asignadas"
            hint="Este alumno todavía no está inscripto en ninguna generación. Andá a la ficha de la generación (Generaciones → nombre) y usá 'Inscribir' desde allí."
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {enrollmentCards.map((card) => (
              <EnrollmentCard
                key={card.enrollmentId}
                studentId={student.id}
                data={card}
                canExpire={canExpire}
                canEdit={canEditParameters}
                canEditParameters={canEditParameters}
                canEditModules={canEditModules}
              />
            ))}
            <div
              className="kg-t7"
              style={{
                color: "var(--kg-text-3)",
                padding: "0 2px",
                fontStyle: "italic",
              }}
            >
              Para quitar una inscripción (o linkearla a una venta), andá a la
              ficha de la generación.
            </div>
          </div>
        )}
      </Panel>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 16,
        }}
      >
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
        <Panel title="Exámenes">
          <EmptyState
            icon={<IconAca size={22} />}
            title="Sub-sección en construcción"
            hint={`${examsCount} exámenes — score, passed, taken_at, por generación.`}
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
