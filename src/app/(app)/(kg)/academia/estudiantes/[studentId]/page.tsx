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
import { EnrollmentExpireButton } from "./enrollment-expire-button";
import {
  ModulesProgressPanel,
  type EnrollmentProgressGroup,
  type ModuleProgressEntry,
} from "./modules-progress-panel";
import {
  ParametersPanel,
  type EnrollmentGroup,
  type EnrollmentParameterEntry,
} from "./parameters-panel";
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
  expired: "Vencido",
};

const ENROLL_STATUS_TONE: Record<EnrollStatus, string> = {
  active: "var(--kg-positive-500)",
  completed: "var(--kg-accent-500)",
  dropped: "var(--kg-negative-500)",
  suspended: "var(--kg-warning-500)",
  expired: "var(--kg-negative-500)",
};

type AccessBadge =
  | { kind: "vigente"; label: string; tone: string }
  | { kind: "por_vencer"; label: string; tone: string }
  | { kind: "vencido"; label: string; tone: string }
  | { kind: "sin_vigencia"; label: string; tone: string };

function computeAccessBadge(
  status: EnrollStatus,
  accessExpiresAt: string | null,
): AccessBadge {
  if (status === "expired") {
    return { kind: "vencido", label: "Vencido", tone: "var(--kg-negative-500)" };
  }
  if (!accessExpiresAt) {
    return {
      kind: "sin_vigencia",
      label: "Sin vigencia",
      tone: "var(--kg-neutral-500)",
    };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expDate = new Date(`${accessExpiresAt}T12:00:00Z`);
  const diffDays = Math.floor(
    (expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays < 0) {
    return {
      kind: "vencido",
      label: "Vencido",
      tone: "var(--kg-negative-500)",
    };
  }
  if (diffDays <= 7) {
    return {
      kind: "por_vencer",
      label: `Por vencer · ${diffDays}d`,
      tone: "var(--kg-warning-500)",
    };
  }
  return {
    kind: "vigente",
    label: "Vigente",
    tone: "var(--kg-positive-500)",
  };
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
        "id, cohort_id, sale_id, enrolled_at, status, progress_percent, access_expires_at",
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
      .select("id, product_id, project_id, progress_source")
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

  // ── Parámetros (Fase B) ────────────────────────────────────────────────
  // Mapeo cohort_id → course_id (para reagrupar los parámetros por cohort).
  const enrollmentCohortIds = enrollmentRows.map((e) => e.cohort_id);
  const cohortCourseMap = new Map<string, string>();
  if (enrollmentCohortIds.length > 0) {
    const { data: cohortCoursesData } = await supabase
      .from("cohorts")
      .select("id, course_id")
      .in("id", enrollmentCohortIds);
    for (const row of (cohortCoursesData ?? []) as unknown as {
      id: string;
      course_id: string | null;
    }[]) {
      if (row.course_id) cohortCourseMap.set(row.id, row.course_id);
    }
  }

  const courseIdsForParams = Array.from(new Set(cohortCourseMap.values()));
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

  const parameterGroups: EnrollmentGroup[] = enrollmentRows.map((e) => {
    const courseId = cohortCourseMap.get(e.cohort_id) ?? null;
    const paramsForCourse = courseId
      ? paramsByCourse.get(courseId) ?? []
      : [];
    const cohortLabel = cohortNameById.get(e.cohort_id) ?? "generación";
    const courseLabel = courseId
      ? courseNameById.get(courseId) ?? "Curso"
      : "Sin curso";

    const parameters: EnrollmentParameterEntry[] = paramsForCourse.map((p) => {
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
      courseId: courseId ?? "",
      cohortId: e.cohort_id,
      cohortName: cohortLabel,
      courseName: courseLabel,
      parameters,
    };
  });

  const canEditParameters = await userCanEditProject(student.project_id);

  // ── Progreso de módulos (Fase C) ────────────────────────────────────────
  // Solo aplica a enrollments cuyo curso tenga progress_source in
  // ('ghl_tags','manual'). El panel filtra por eso, pero fetcheamos módulos +
  // progreso siempre para simplificar el flujo.
  const courseProgressSourceById = new Map<string, string>();
  for (const c of studentCourseRows) {
    courseProgressSourceById.set(c.id, c.progress_source);
  }

  const trackedCourseIds = Array.from(new Set(cohortCourseMap.values())).filter(
    (cid) => {
      const src = courseProgressSourceById.get(cid);
      return src === "ghl_tags" || src === "manual";
    },
  );

  const [modulesRes, progressRes] = await Promise.all([
    trackedCourseIds.length > 0
      ? supabase
          .from("course_modules")
          .select("id, course_id, name, order_index")
          .in("course_id", trackedCourseIds)
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

  const progressGroups: EnrollmentProgressGroup[] = enrollmentRows.map((e) => {
    const courseId = cohortCourseMap.get(e.cohort_id) ?? "";
    const source = (courseProgressSourceById.get(courseId) ?? "attendance") as
      | "attendance"
      | "ghl_tags"
      | "manual";
    const modulesForCourse = modulesByCourse.get(courseId) ?? [];
    const modules: ModuleProgressEntry[] = modulesForCourse.map((m) => {
      const p = progressByEnrollmentAndModule.get(`${e.id}::${m.id}`);
      return {
        moduleId: m.id,
        moduleName: m.name,
        orderIndex: m.order_index,
        completedAt: p?.completed_at ?? null,
        source: p?.source ?? null,
      };
    });
    return {
      enrollmentId: e.id,
      cohortId: e.cohort_id,
      cohortName: cohortNameById.get(e.cohort_id) ?? "generación",
      courseId,
      courseName: courseId
        ? courseNameById.get(courseId) ?? "Curso"
        : "Sin curso",
      progressSource: source,
      modules,
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
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
              {enrollmentRows.map((e) => {
                const badge = computeAccessBadge(e.status, e.access_expires_at);
                const cohortLabel =
                  cohortNameById.get(e.cohort_id) ?? "generación";
                return (
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
                        {cohortLabel}
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
                        {e.access_expires_at && (
                          <span>
                            vence {formatDate(e.access_expires_at)}
                          </span>
                        )}
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
                      <StatusPill text={badge.label} tone={badge.tone} />
                      <div
                        className="kg-t7"
                        style={{
                          color: "var(--kg-text-3)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {e.progress_percent}%
                      </div>
                      {canExpire && e.status === "active" && (
                        <EnrollmentExpireButton
                          enrollmentId={e.id}
                          studentId={student.id}
                          cohortLabel={cohortLabel}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
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

      <Panel title="Progreso por módulos">
        <ModulesProgressPanel groups={progressGroups} />
      </Panel>

      <Panel title="Parámetros">
        <ParametersPanel
          studentId={student.id}
          canEdit={canEditParameters}
          groups={parameterGroups}
        />
      </Panel>
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
