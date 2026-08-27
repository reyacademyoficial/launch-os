import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconAca } from "@/components/kg/icons";
import { KgPageFilters } from "@/components/kg/page-menu";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";
import { createClient } from "@/lib/supabase/server";

import {
  ClearFiltersButton,
  PersistentFilterSync,
} from "../_shared/persistent-filters";
import type { ImportProjectOption } from "./import-students-button";
import {
  PendingBuyersView,
  type CohortOptionForBulk,
  type PendingBuyer,
} from "./pending-buyers-view";
import { StudentPanelActions } from "./student-panel-actions";
import type { ProjectOptionForStudent } from "./student-form-drawer";
import { StudentsView, type StudentRowData } from "./students-view";

export const metadata: Metadata = { title: "Estudiantes · Academia" };

// La pestaña "Compradores pendientes" depende de sales/leads que se
// crean fuera del ciclo de Kingrow (LaunchOS, sync de GHL). Forzamos
// dynamic para evitar snapshot cacheado — el volumen es bajo y la
// consulta rápida, no vale la pena optimizar.
export const dynamic = "force-dynamic";

type Status = "active" | "inactive" | "graduated";
type ShowFilter =
  | "active"
  | "graduated"
  | "inactive"
  | "all"
  | "pending"
  | "expiring";

interface StudentDbRow {
  readonly id: string;
  readonly project_id: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly status: Status;
  readonly enrolled_at: string;
  readonly notes: string | null;
}

interface ProjectDbRow {
  readonly id: string;
  readonly name: string;
  readonly ownership: string;
}

interface CourseLink {
  readonly id: string;
  readonly product_id: string;
  readonly project_id: string;
}

interface SaleDbRow {
  readonly id: string;
  readonly project_id: string;
  readonly product_id: string;
  readonly lead_id: string | null;
  readonly total_amount: number | string;
  readonly currency: string | null;
  readonly created_at: string;
}

interface LeadDbRow {
  readonly id: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly phone_normalized: string | null;
}

interface ProductDbRow {
  readonly id: string;
  readonly name: string;
}

interface EnrollmentLink {
  readonly student_id: string;
  readonly cohort_id: string;
}

interface ExpiringEnrollmentRow {
  readonly student_id: string;
  readonly access_expires_at: string | null;
}

interface CohortDbRow {
  readonly id: string;
  readonly project_id: string;
  readonly course_id: string | null;
  readonly name: string;
  readonly status: "planned" | "active" | "finished" | "cancelled";
}

export default async function EstudiantesPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const show = parseShow(sp.show);

  const supabase = await createClient();

  const [
    studentsRes,
    projectsRes,
    coursesRes,
    productsRes,
    enrollmentsRes,
    cohortsRes,
  ] = await Promise.all([
    supabase
      .from("students")
      .select("id, project_id, name, email, phone, status, notes, enrolled_at")
      .order("name", { ascending: true }),
    supabase
      .from("projects")
      .select("id, name, ownership")
      .eq("ownership", "propia"),
    supabase
      .from("courses")
      .select("id, product_id, project_id")
      .eq("active", true),
    supabase.from("products").select("id, name"),
    supabase.from("enrollments").select("student_id, cohort_id"),
    supabase.from("cohorts").select("id, project_id, course_id, name, status"),
  ]);

  const allStudents =
    (studentsRes.data ?? []) as unknown as StudentDbRow[];
  const propiaProjects =
    (projectsRes.data ?? []) as unknown as ProjectDbRow[];
  const activeCourses =
    (coursesRes.data ?? []) as unknown as CourseLink[];
  const allProducts =
    (productsRes.data ?? []) as unknown as ProductDbRow[];
  const enrollments =
    (enrollmentsRes.data ?? []) as unknown as EnrollmentLink[];
  const allCohorts =
    (cohortsRes.data ?? []) as unknown as CohortDbRow[];

  const projectNameById = new Map<string, string>();
  for (const p of propiaProjects) projectNameById.set(p.id, p.name);

  const productNameById = new Map<string, string>();
  for (const p of allProducts) productNameById.set(p.id, p.name);

  // Map cohort_id → cohort para poder resolver nombres/status por enrollment.
  const cohortById = new Map<string, CohortDbRow>();
  for (const c of allCohorts) cohortById.set(c.id, c);

  // Cohortes por student (todas las que tiene inscriptas). Ordenamos active
  // primero, después finished, después el resto — para que la primera sea la
  // más relevante para mostrar en la tabla.
  const cohortsByStudent = new Map<string, CohortDbRow[]>();
  for (const e of enrollments) {
    const cohort = cohortById.get(e.cohort_id);
    if (!cohort) continue;
    const bucket = cohortsByStudent.get(e.student_id) ?? [];
    bucket.push(cohort);
    cohortsByStudent.set(e.student_id, bucket);
  }
  const cohortStatusRank: Record<CohortDbRow["status"], number> = {
    active: 0,
    planned: 1,
    finished: 2,
    cancelled: 3,
  };
  for (const bucket of cohortsByStudent.values()) {
    bucket.sort(
      (a, b) => cohortStatusRank[a.status] - cohortStatusRank[b.status],
    );
  }

  // Derivar el status "efectivo" del alumno desde sus cohortes:
  //   - Si tiene alguna cohort activa → activo.
  //   - Si no, y tiene alguna cohort terminada → graduado.
  //   - Si el alumno está marcado inactive manualmente → respetamos ese
  //     override (dropout explícito) por encima de la cohort.
  //   - Sin cohortes / cohortes solo planned/cancelled → fallback al status
  //     que trae la fila de students.
  function deriveStatus(student: StudentDbRow): Status {
    if (student.status === "inactive") return "inactive";
    const bucket = cohortsByStudent.get(student.id);
    if (bucket && bucket.length > 0) {
      if (bucket.some((c) => c.status === "active")) return "active";
      if (bucket.some((c) => c.status === "finished")) return "graduated";
    }
    return student.status;
  }

  // Enrollments activos con vigencia dentro de los próximos 7 días — para el
  // filtro "Por vencer" del listado. La query pega al índice parcial
  // `enrollments_active_expiring_idx` (migración 0144).
  const todayYmd = new Date().toISOString().slice(0, 10);
  const in7DaysYmd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const expiringRes = await supabase
    .from("enrollments")
    .select("student_id, access_expires_at")
    .eq("status", "active")
    .not("access_expires_at", "is", null)
    .gte("access_expires_at", todayYmd)
    .lte("access_expires_at", in7DaysYmd);
  const expiringRows =
    (expiringRes.data ?? []) as unknown as ExpiringEnrollmentRow[];
  const expiringStudentIds = new Set<string>();
  for (const e of expiringRows) expiringStudentIds.add(e.student_id);

  // Courses indexado por product_id (unique en la tabla) — el flujo
  // "comprador → curso" pasa por matching product_id.
  const courseByProductId = new Map<string, CourseLink>();
  for (const c of activeCourses) courseByProductId.set(c.product_id, c);

  // Cohorts agrupadas por course_id — para el drawer de bulk create con
  // "inscribir en generación".
  const cohortsByCourse: Record<string, CohortOptionForBulk[]> = {};
  for (const c of allCohorts) {
    if (!c.course_id) continue;
    const bucket = cohortsByCourse[c.course_id] ?? [];
    bucket.push({
      id: c.id,
      courseId: c.course_id,
      name: c.name,
      status: c.status,
    });
    cohortsByCourse[c.course_id] = bucket;
  }

  // Segundo batch: sales de products-course + sus leads.
  const courseProductIds = new Set(activeCourses.map((c) => c.product_id));

  const salesRes =
    courseProductIds.size === 0
      ? { data: [] as SaleDbRow[] }
      : await supabase
          .from("sales")
          .select(
            "id, project_id, product_id, lead_id, total_amount, currency, created_at",
          )
          .in("product_id", Array.from(courseProductIds))
          .order("created_at", { ascending: false });
  const allSales = (salesRes.data ?? []) as unknown as SaleDbRow[];

  const leadIds = Array.from(
    new Set(allSales.map((s) => s.lead_id).filter((v): v is string => v != null)),
  );
  const leadsRes =
    leadIds.length === 0
      ? { data: [] as LeadDbRow[] }
      : await supabase
          .from("leads")
          .select("id, name, email, phone_normalized")
          .in("id", leadIds);
  const allLeads = (leadsRes.data ?? []) as unknown as LeadDbRow[];
  const leadById = new Map<string, LeadDbRow>();
  for (const l of allLeads) leadById.set(l.id, l);

  // Filtrar sales de products-course cuyo comprador NO está aún como
  // student. Matching por email primero, fallback por teléfono
  // normalizado, ambos scoped al project_id de la venta.
  const studentKeysByProject = new Set<string>();
  for (const s of allStudents) {
    if (s.email) {
      studentKeysByProject.add(`${s.project_id}::email::${s.email.toLowerCase()}`);
    }
    if (s.phone) {
      studentKeysByProject.add(`${s.project_id}::phone::${s.phone}`);
    }
  }
  function isAlreadyStudent(projectId: string, lead: LeadDbRow): boolean {
    if (lead.email) {
      if (
        studentKeysByProject.has(
          `${projectId}::email::${lead.email.toLowerCase()}`,
        )
      ) {
        return true;
      }
    }
    if (lead.phone_normalized) {
      if (
        studentKeysByProject.has(
          `${projectId}::phone::${lead.phone_normalized}`,
        )
      ) {
        return true;
      }
    }
    return false;
  }

  const pendingBuyers: PendingBuyer[] = allSales
    .filter((s) => {
      if (!s.lead_id) return false;
      const lead = leadById.get(s.lead_id);
      if (!lead || !lead.name) return false;
      return !isAlreadyStudent(s.project_id, lead);
    })
    .map((s) => {
      const lead = leadById.get(s.lead_id!)!;
      const course = courseByProductId.get(s.product_id) ?? null;
      return {
        saleId: s.id,
        leadName: lead.name!,
        leadEmail: lead.email,
        leadPhone: lead.phone_normalized,
        productId: s.product_id,
        productName: productNameById.get(s.product_id) ?? "—",
        projectId: s.project_id,
        projectName: projectNameById.get(s.project_id) ?? "—",
        courseId: course?.id ?? null,
        amount: Number(s.total_amount),
        currency: s.currency === "USD" ? "USD" : "ARS",
        createdAt: s.created_at,
      };
    });

  // Todos los counts + filtros usan el status DERIVADO (cohort-driven) para
  // que lo que muestra la ContextBar coincida con lo que filtra el drawer.
  const derivedStatusById = new Map<string, Status>();
  for (const s of allStudents) derivedStatusById.set(s.id, deriveStatus(s));

  const activeCount = allStudents.filter(
    (s) => derivedStatusById.get(s.id) === "active",
  ).length;
  const graduatedCount = allStudents.filter(
    (s) => derivedStatusById.get(s.id) === "graduated",
  ).length;
  const inactiveCount = allStudents.filter(
    (s) => derivedStatusById.get(s.id) === "inactive",
  ).length;

  const filtered = allStudents.filter((s) => {
    const st = derivedStatusById.get(s.id) ?? s.status;
    if (show === "active") return st === "active";
    if (show === "graduated") return st === "graduated";
    if (show === "inactive") return st === "inactive";
    if (show === "pending") return false; // el otro tab gobierna
    if (show === "expiring") return expiringStudentIds.has(s.id);
    return true;
  });

  const rows: StudentRowData[] = filtered.map((s) => {
    const cohorts = cohortsByStudent.get(s.id) ?? [];
    return {
      id: s.id,
      projectId: s.project_id,
      projectName: projectNameById.get(s.project_id) ?? null,
      name: s.name,
      email: s.email,
      phone: s.phone,
      status: derivedStatusById.get(s.id) ?? s.status,
      enrolledAt: s.enrolled_at,
      notes: s.notes,
      cohortNames: cohorts.map((c) => c.name),
    };
  });

  const projectOptions: ProjectOptionForStudent[] = propiaProjects
    .map((p) => ({ id: p.id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Proyectos para el picker del ImportStudentsButton. La resolución de
  // productos + cohortes se hace server-side en /api/academia/estudiantes/
  // template y en las server actions preview/confirm — el picker solo elige
  // a qué proyecto pertenecen los alumnos.
  const importProjects: ImportProjectOption[] = projectOptions;

  const SHOW_OPTIONS: ReadonlyArray<{
    value: ShowFilter;
    label: string;
    badge?: number;
  }> = [
    { value: "active", label: "Activos" },
    { value: "graduated", label: "Graduados" },
    { value: "inactive", label: "Inactivos" },
    { value: "all", label: "Todos" },
    {
      value: "expiring",
      label: "Por vencer (7d)",
      badge: expiringStudentIds.size,
    },
    {
      value: "pending",
      label: "Compradores pendientes",
      badge: pendingBuyers.length,
    },
  ];

  function buildHref(nextShow: ShowFilter): string {
    const params = new URLSearchParams();
    if (nextShow !== "active") params.set("show", nextShow);
    const qs = params.toString();
    return qs ? `/academia/estudiantes?${qs}` : "/academia/estudiantes";
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <ContextBar
        icon={<IconAca size={16} />}
        title="Estudiantes"
        stats={[
          { l: "Activos", v: fCount(activeCount) },
          { l: "Graduados", v: fCount(graduatedCount) },
          { l: "Inactivos", v: fCount(inactiveCount) },
          {
            l: "Compradores pendientes",
            v: fCount(pendingBuyers.length),
            c: pendingBuyers.length > 0 ? "#FFB800" : undefined,
          },
        ]}
      />

      <PersistentFilterSync storageKey="academia:filters:estudiantes" />

      <KgPageFilters activeCount={show !== "active" ? 1 : 0}>
        <KgParamPills
          ariaLabel="Filtrar por estado"
          options={SHOW_OPTIONS.map((o) => ({
            label:
              o.badge && o.badge > 0 ? `${o.label} (${o.badge})` : o.label,
            href: buildHref(o.value),
            active: show === o.value,
          }))}
        />
        <ClearFiltersButton
          storageKey="academia:filters:estudiantes"
          basePath="/academia/estudiantes"
        />
      </KgPageFilters>

      {show === "pending" ? (
        <Panel title="Compradores pendientes de alta" pad={false} fillHeight>
          <PendingBuyersView
            buyers={pendingBuyers}
            cohortsByCourse={cohortsByCourse}
          />
        </Panel>
      ) : (
        <Panel
          title="Estudiantes"
          pad={false}
          fillHeight
          actions={
            <StudentPanelActions
              projects={projectOptions}
              importProjects={importProjects}
            />
          }
        >
          <StudentsView
            rows={rows}
            totalCount={rows.length}
            projects={projectOptions}
          />
        </Panel>
      )}
    </div>
  );
}

function parseShow(v: string | string[] | undefined): ShowFilter {
  if (typeof v !== "string") return "active";
  if (
    v === "graduated" ||
    v === "inactive" ||
    v === "all" ||
    v === "pending" ||
    v === "expiring"
  ) {
    return v;
  }
  return "active";
}
