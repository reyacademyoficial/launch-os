import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconAca } from "@/components/kg/icons";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";
import { createClient } from "@/lib/supabase/server";

import type { PendingSale } from "./create-from-sale-drawer";
import type { ProjectOptionForStudent } from "./student-form-drawer";
import { StudentsView, type StudentRowData } from "./students-view";

export const metadata: Metadata = { title: "Estudiantes · Academia" };

type Status = "active" | "inactive" | "graduated";
type ShowFilter = "active" | "graduated" | "inactive" | "all";

const SHOW_OPTIONS: ReadonlyArray<{ value: ShowFilter; label: string }> = [
  { value: "active", label: "Activos" },
  { value: "graduated", label: "Graduados" },
  { value: "inactive", label: "Inactivos" },
  { value: "all", label: "Todos" },
];

interface StudentDbRow {
  readonly id: string;
  readonly project_id: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly status: Status;
  readonly notes: string | null;
}

interface ProjectDbRow {
  readonly id: string;
  readonly name: string;
  readonly ownership: string;
}

interface CourseLink {
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
  readonly phone: string | null;
}

interface ProductDbRow {
  readonly id: string;
  readonly name: string;
}

interface EnrollmentLink {
  readonly student_id: string;
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
  ] = await Promise.all([
    supabase
      .from("students")
      .select("id, project_id, name, email, phone, status, notes")
      .order("name", { ascending: true }),
    supabase
      .from("projects")
      .select("id, name, ownership")
      .eq("ownership", "propia"),
    supabase
      .from("courses")
      .select("product_id, project_id")
      .eq("active", true),
    supabase.from("products").select("id, name"),
    supabase.from("enrollments").select("student_id"),
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

  const projectNameById = new Map<string, string>();
  for (const p of propiaProjects) projectNameById.set(p.id, p.name);

  const productNameById = new Map<string, string>();
  for (const p of allProducts) productNameById.set(p.id, p.name);

  const enrollmentsByStudent = new Map<string, number>();
  for (const e of enrollments) {
    enrollmentsByStudent.set(
      e.student_id,
      (enrollmentsByStudent.get(e.student_id) ?? 0) + 1,
    );
  }

  // Segundo batch: fetch de sales de products-course + sus leads.
  // Depende del primer batch — necesita los product_ids que son courses.
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
          .select("id, name, email, phone")
          .in("id", leadIds);
  const allLeads = (leadsRes.data ?? []) as unknown as LeadDbRow[];
  const leadById = new Map<string, LeadDbRow>();
  for (const l of allLeads) leadById.set(l.id, l);

  // Filtrar sales de products-course cuyo (project_id, email/phone del
  // lead) NO están ya como student. Matching por email en primer lugar,
  // fallback por phone.
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
    if (lead.phone) {
      const normalized = lead.phone.replace(/[^\d+]/g, "");
      if (studentKeysByProject.has(`${projectId}::phone::${normalized}`)) {
        return true;
      }
    }
    return false;
  }

  const pendingSales: PendingSale[] = allSales
    .filter((s) => {
      if (!s.lead_id) return false;
      const lead = leadById.get(s.lead_id);
      if (!lead || !lead.name) return false;
      // Ver si ya existe un student en el mismo proyecto con matching.
      return !isAlreadyStudent(s.project_id, lead);
    })
    .map((s) => {
      const lead = leadById.get(s.lead_id!)!;
      return {
        saleId: s.id,
        leadName: lead.name!,
        leadEmail: lead.email,
        leadPhone: lead.phone,
        productName: productNameById.get(s.product_id) ?? "—",
        projectName: projectNameById.get(s.project_id) ?? "—",
        amount: Number(s.total_amount),
        currency: s.currency === "USD" ? "USD" : "ARS",
        createdAt: s.created_at,
      };
    });

  const activeCount = allStudents.filter((s) => s.status === "active").length;
  const graduatedCount = allStudents.filter(
    (s) => s.status === "graduated",
  ).length;
  const inactiveCount = allStudents.filter(
    (s) => s.status === "inactive",
  ).length;

  const filtered = allStudents.filter((s) => {
    if (show === "active") return s.status === "active";
    if (show === "graduated") return s.status === "graduated";
    if (show === "inactive") return s.status === "inactive";
    return true;
  });

  const rows: StudentRowData[] = filtered.map((s) => ({
    id: s.id,
    projectId: s.project_id,
    projectName: projectNameById.get(s.project_id) ?? null,
    name: s.name,
    email: s.email,
    phone: s.phone,
    status: s.status,
    notes: s.notes,
    enrollmentsCount: enrollmentsByStudent.get(s.id) ?? 0,
  }));

  const projectOptions: ProjectOptionForStudent[] = propiaProjects
    .map((p) => ({ id: p.id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  function buildHref(nextShow: ShowFilter): string {
    const params = new URLSearchParams();
    if (nextShow !== "active") params.set("show", nextShow);
    const qs = params.toString();
    return qs ? `/academia/estudiantes?${qs}` : "/academia/estudiantes";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconAca size={16} />}
        title="Estudiantes"
        stats={[
          { l: "Activos", v: fCount(activeCount) },
          { l: "Graduados", v: fCount(graduatedCount) },
          { l: "Inactivos", v: fCount(inactiveCount) },
          {
            l: "Compradores pendientes",
            v: fCount(pendingSales.length),
            c: pendingSales.length > 0 ? "#FFB800" : undefined,
          },
        ]}
      />

      <KgParamPills
        ariaLabel="Filtrar por estado"
        options={SHOW_OPTIONS.map((o) => ({
          label: o.label,
          href: buildHref(o.value),
          active: show === o.value,
        }))}
      />

      <Panel title="Estudiantes">
        <StudentsView
          rows={rows}
          totalCount={rows.length}
          projects={projectOptions}
          pendingSales={pendingSales}
        />
      </Panel>
    </div>
  );
}

function parseShow(v: string | string[] | undefined): ShowFilter {
  if (typeof v !== "string") return "active";
  if (v === "graduated" || v === "inactive" || v === "all") return v;
  return "active";
}
