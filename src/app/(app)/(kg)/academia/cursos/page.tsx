import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconAca } from "@/components/kg/icons";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";
import { createClient } from "@/lib/supabase/server";

import type { ProductOptionForCourse } from "./course-form-drawer";
import { CoursesView, type CourseRowData } from "./courses-view";

export const metadata: Metadata = { title: "Cursos · Academia" };

type ShowFilter = "active" | "inactive" | "all";

const SHOW_OPTIONS: ReadonlyArray<{ value: ShowFilter; label: string }> = [
  { value: "active", label: "Activos" },
  { value: "inactive", label: "Archivados" },
  { value: "all", label: "Todos" },
];

interface CourseDbRow {
  readonly id: string;
  readonly product_id: string;
  readonly project_id: string;
  readonly duration_hours: number | null;
  readonly modules_count: number | null;
  readonly active: boolean;
}

interface ProductDbRow {
  readonly id: string;
  readonly name: string;
  readonly project_id: string;
}

interface ProjectDbRow {
  readonly id: string;
  readonly name: string;
  readonly ownership: string;
}

interface CohortLink {
  readonly course_id: string | null;
}

export default async function CursosPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const show = parseShow(sp.show);

  const supabase = await createClient();

  const [coursesRes, productsRes, projectsRes, cohortsRes] = await Promise.all([
    supabase
      .from("courses")
      .select(
        "id, product_id, project_id, duration_hours, modules_count, active",
      )
      .order("active", { ascending: false }),
    supabase.from("products").select("id, name, project_id"),
    supabase
      .from("projects")
      .select("id, name, ownership")
      .eq("ownership", "propia"),
    supabase.from("cohorts").select("course_id").not("course_id", "is", null),
  ]);

  const allCourses = (coursesRes.data ?? []) as unknown as CourseDbRow[];
  const allProducts = (productsRes.data ?? []) as unknown as ProductDbRow[];
  const propiaProjects =
    (projectsRes.data ?? []) as unknown as ProjectDbRow[];
  const cohortLinks =
    (cohortsRes.data ?? []) as unknown as CohortLink[];

  const propiaProjectIds = new Set(propiaProjects.map((p) => p.id));
  const projectNameById = new Map<string, string>();
  for (const p of propiaProjects) projectNameById.set(p.id, p.name);

  const productById = new Map<string, ProductDbRow>();
  for (const p of allProducts) productById.set(p.id, p);

  const cohortsByCourse = new Map<string, number>();
  for (const c of cohortLinks) {
    if (!c.course_id) continue;
    cohortsByCourse.set(
      c.course_id,
      (cohortsByCourse.get(c.course_id) ?? 0) + 1,
    );
  }

  const alreadyCourseProductIds = new Set(allCourses.map((c) => c.product_id));

  const filtered = allCourses.filter((c) => {
    if (show === "active") return c.active;
    if (show === "inactive") return !c.active;
    return true;
  });

  const rows: CourseRowData[] = filtered.map((c) => {
    const product = productById.get(c.product_id);
    return {
      id: c.id,
      productId: c.product_id,
      productName: product?.name ?? "—",
      projectName: projectNameById.get(c.project_id) ?? null,
      durationHours: c.duration_hours,
      modulesCount: c.modules_count,
      active: c.active,
      cohortsCount: cohortsByCourse.get(c.id) ?? 0,
    };
  });

  // Products disponibles: solo los de projects propios. Marcamos si ya
  // son course para que el drawer los deshabilite en create.
  const products: ProductOptionForCourse[] = allProducts
    .filter((p) => propiaProjectIds.has(p.project_id))
    .map((p) => ({
      id: p.id,
      name: p.name,
      projectName: projectNameById.get(p.project_id) ?? null,
      alreadyCourse: alreadyCourseProductIds.has(p.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const activeCount = allCourses.filter((c) => c.active).length;
  const inactiveCount = allCourses.length - activeCount;
  const availableProductsCount = products.filter((p) => !p.alreadyCourse).length;

  function buildHref(nextShow: ShowFilter): string {
    const params = new URLSearchParams();
    if (nextShow !== "active") params.set("show", nextShow);
    const qs = params.toString();
    return qs ? `/academia/cursos?${qs}` : "/academia/cursos";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconAca size={16} />}
        title="Cursos"
        stats={[
          { l: "Activos", v: fCount(activeCount) },
          { l: "Archivados", v: fCount(inactiveCount) },
          { l: "Productos convertibles", v: fCount(availableProductsCount) },
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

      <Panel title="Cursos">
        <CoursesView
          rows={rows}
          totalCount={rows.length}
          products={products}
        />
      </Panel>
    </div>
  );
}

function parseShow(v: string | string[] | undefined): ShowFilter {
  if (typeof v !== "string") return "active";
  if (v === "inactive" || v === "all") return v;
  return "active";
}
