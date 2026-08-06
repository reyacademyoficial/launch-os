import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconAca } from "@/components/kg/icons";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";
import { createClient } from "@/lib/supabase/server";

import type {
  CourseOptionForCohort,
  ProjectOptionForCohort,
} from "./cohort-form-drawer";
import { CohortsView, type CohortRowData } from "./cohorts-view";

export const metadata: Metadata = { title: "Cohortes · Academia" };

type Status = "planned" | "active" | "finished" | "cancelled";
type StatusFilter = "activas" | "cerradas" | "todas";

const STATUS_FILTER_OPTIONS: ReadonlyArray<{
  value: StatusFilter;
  label: string;
}> = [
  { value: "activas", label: "Activas" },
  { value: "cerradas", label: "Cerradas" },
  { value: "todas", label: "Todas" },
];

const OPEN_STATUSES: ReadonlySet<Status> = new Set(["planned", "active"]);

interface CohortDbRow {
  readonly id: string;
  readonly project_id: string;
  readonly course_id: string | null;
  readonly name: string;
  readonly start_date: string;
  readonly end_date: string;
  readonly status: Status;
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

interface EnrollmentLink {
  readonly cohort_id: string;
}

export default async function CohortesPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const statusFilter = parseStatus(sp.status);

  const supabase = await createClient();

  const [cohortsRes, projectsRes, coursesRes, productsRes, enrollmentsRes] =
    await Promise.all([
      supabase
        .from("cohorts")
        .select(
          "id, project_id, course_id, name, start_date, end_date, status, notes",
        )
        .order("start_date", { ascending: false }),
      supabase
        .from("projects")
        .select("id, name, ownership")
        .eq("ownership", "propia"),
      supabase
        .from("courses")
        .select("id, product_id, project_id, active")
        .eq("active", true),
      supabase.from("products").select("id, name"),
      supabase.from("enrollments").select("cohort_id"),
    ]);

  const allCohorts = (cohortsRes.data ?? []) as unknown as CohortDbRow[];
  const propiaProjects =
    (projectsRes.data ?? []) as unknown as ProjectDbRow[];
  const activeCourses =
    (coursesRes.data ?? []) as unknown as CourseDbRow[];
  const allProducts = (productsRes.data ?? []) as unknown as ProductDbRow[];
  const enrollments =
    (enrollmentsRes.data ?? []) as unknown as EnrollmentLink[];

  const projectNameById = new Map<string, string>();
  for (const p of propiaProjects) projectNameById.set(p.id, p.name);

  const productNameById = new Map<string, string>();
  for (const p of allProducts) productNameById.set(p.id, p.name);

  const courseNameById = new Map<string, string>();
  for (const c of activeCourses) {
    courseNameById.set(c.id, productNameById.get(c.product_id) ?? "—");
  }

  const enrollmentsByCohort = new Map<string, number>();
  for (const e of enrollments) {
    enrollmentsByCohort.set(
      e.cohort_id,
      (enrollmentsByCohort.get(e.cohort_id) ?? 0) + 1,
    );
  }

  const filtered = allCohorts.filter((c) => {
    if (statusFilter === "activas") return OPEN_STATUSES.has(c.status);
    if (statusFilter === "cerradas") return !OPEN_STATUSES.has(c.status);
    return true;
  });

  const rows: CohortRowData[] = filtered.map((c) => ({
    id: c.id,
    projectId: c.project_id,
    projectName: projectNameById.get(c.project_id) ?? null,
    courseId: c.course_id,
    courseName: c.course_id ? courseNameById.get(c.course_id) ?? null : null,
    name: c.name,
    startDate: c.start_date,
    endDate: c.end_date,
    status: c.status,
    notes: c.notes,
    enrollmentsCount: enrollmentsByCohort.get(c.id) ?? 0,
  }));

  // Options para el drawer.
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

  // Stats sobre TODAS las cohortes.
  const activeCount = allCohorts.filter((c) => c.status === "active").length;
  const plannedCount = allCohorts.filter((c) => c.status === "planned").length;
  const finishedCount = allCohorts.filter(
    (c) => c.status === "finished",
  ).length;

  function buildHref(nextStatus: StatusFilter): string {
    const params = new URLSearchParams();
    if (nextStatus !== "activas") params.set("status", nextStatus);
    const qs = params.toString();
    return qs ? `/academia/cohortes?${qs}` : "/academia/cohortes";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconAca size={16} />}
        title="Cohortes"
        stats={[
          { l: "Activas", v: fCount(activeCount) },
          { l: "Planeadas", v: fCount(plannedCount) },
          { l: "Terminadas", v: fCount(finishedCount) },
          { l: "Total", v: fCount(allCohorts.length) },
        ]}
      />

      <KgParamPills
        ariaLabel="Filtrar por estado"
        options={STATUS_FILTER_OPTIONS.map((o) => ({
          label: o.label,
          href: buildHref(o.value),
          active: statusFilter === o.value,
        }))}
      />

      <Panel title="Cohortes">
        <CohortsView
          rows={rows}
          totalCount={rows.length}
          projects={projectOptions}
          courses={courseOptions}
        />
      </Panel>
    </div>
  );
}

function parseStatus(v: string | string[] | undefined): StatusFilter {
  if (typeof v !== "string") return "activas";
  if (v === "cerradas" || v === "todas") return v;
  return "activas";
}
