import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconAca } from "@/components/kg/icons";
import { KgPageFilters } from "@/components/kg/page-menu";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import {
  getAllCourses,
  getAllExternalApps,
  getAllProducts,
  getPropiaProjects,
} from "@/lib/academia/reference";
import { fCount } from "@/lib/finance/format";
import { createClient } from "@/lib/supabase/server";

import type {
  ExternalAppOptionForCourse,
  ProductOptionForCourse,
} from "./course-form-drawer";
import { CoursesView, type CourseRowData } from "./courses-view";
import { NewCourseButton } from "./new-course-button";
import type { ParameterRowData } from "./parameters-editor";

export const metadata: Metadata = { title: "Cursos · Academia" };

type ShowFilter = "active" | "inactive" | "all";

const SHOW_OPTIONS: ReadonlyArray<{ value: ShowFilter; label: string }> = [
  { value: "active", label: "Activos" },
  { value: "inactive", label: "Archivados" },
  { value: "all", label: "Todos" },
];

interface CohortLink {
  readonly course_id: string | null;
}

interface ParameterDbRow {
  readonly id: string;
  readonly course_id: string;
  readonly key: string;
  readonly label: string;
  readonly type: "boolean" | "integer";
  readonly required: boolean;
  readonly order_index: number;
}

export default async function CursosPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const show = parseShow(sp.show);

  const supabase = await createClient();

  const [
    allCourses,
    allProducts,
    propiaProjects,
    allExternalApps,
    cohortsRes,
    parametersRes,
  ] = await Promise.all([
    getAllCourses(),
    getAllProducts(),
    getPropiaProjects(),
    getAllExternalApps(),
    supabase.from("cohorts").select("course_id").not("course_id", "is", null),
    supabase
      .from("course_parameters")
      .select("id, course_id, key, label, type, required, order_index")
      .order("order_index", { ascending: true }),
  ]);

  const cohortLinks =
    (cohortsRes.data ?? []) as unknown as CohortLink[];

  const propiaProjectIds = new Set(propiaProjects.map((p) => p.id));
  const projectNameById = new Map<string, string>();
  for (const p of propiaProjects) projectNameById.set(p.id, p.name);

  const productById = new Map<string, { id: string; name: string; project_id: string }>();
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

  const allParameters =
    (parametersRes.data ?? []) as unknown as ParameterDbRow[];
  const parametersByCourseId: Record<string, ParameterRowData[]> = {};
  for (const p of allParameters) {
    const arr = parametersByCourseId[p.course_id] ?? [];
    arr.push({
      id: p.id,
      key: p.key,
      label: p.label,
      type: p.type,
      required: p.required,
      orderIndex: p.order_index,
    });
    parametersByCourseId[p.course_id] = arr;
  }

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
      defaultAccessDays: c.default_access_days,
      ghlExpirationWebhookUrl: c.ghl_expiration_webhook_url,
      externalAppId: c.external_app_id,
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
      projectId: p.project_id,
      alreadyCourse: alreadyCourseProductIds.has(p.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const externalApps: ExternalAppOptionForCourse[] = allExternalApps
    .filter((a) => propiaProjectIds.has(a.project_id))
    .map((a) => ({
      id: a.id,
      name: a.name,
      projectId: a.project_id,
      active: a.active,
    }));

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
    <div className="flex h-full min-h-0 flex-col gap-5">
      <ContextBar
        icon={<IconAca size={16} />}
        title="Cursos"
        stats={[
          { l: "Activos", v: fCount(activeCount) },
          { l: "Archivados", v: fCount(inactiveCount) },
          { l: "Productos convertibles", v: fCount(availableProductsCount) },
        ]}
      />

      <KgPageFilters activeCount={show !== "active" ? 1 : 0}>
        <KgParamPills
          ariaLabel="Filtrar por estado"
          options={SHOW_OPTIONS.map((o) => ({
            label: o.label,
            href: buildHref(o.value),
            active: show === o.value,
          }))}
        />
      </KgPageFilters>

      <Panel
        title="Cursos"
        pad={false}
        fillHeight
        actions={
          <NewCourseButton products={products} externalApps={externalApps} />
        }
      >
        <CoursesView
          rows={rows}
          totalCount={rows.length}
          products={products}
          externalApps={externalApps}
          parametersByCourseId={parametersByCourseId}
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
