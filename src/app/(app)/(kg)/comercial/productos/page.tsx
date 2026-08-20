import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconOrg } from "@/components/kg/icons";
import { KgPageFilters } from "@/components/kg/page-menu";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";
import { listAllProducts } from "@/lib/products/list";
import { listAccessibleProjects } from "@/lib/projects/list";
import { createClient } from "@/lib/supabase/server";

import type { ProjectOption } from "./product-form-drawer";
import { ProductosView, type ProductRowData } from "./productos-view";

export const metadata: Metadata = { title: "Productos · Comercial" };

// Estado del producto (activos / dados de baja / todos) + filtro por proyecto.
type ActiveParam = "activos" | "inactivos" | "todos";

const ACTIVE_OPTIONS: ReadonlyArray<{ value: ActiveParam; label: string }> = [
  { value: "activos", label: "Activos" },
  { value: "inactivos", label: "Dados de baja" },
  { value: "todos", label: "Todos" },
];

interface SaleCountRow {
  readonly product_id: string | null;
}

export default async function ProductosPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const activeParam = parseActive(sp.state);
  const projectFilter =
    typeof sp.project === "string" && sp.project.trim().length > 0
      ? sp.project
      : null;

  const supabase = await createClient();
  const [products, projects, salesRes] = await Promise.all([
    listAllProducts(),
    listAccessibleProjects(),
    // Conteo de ventas por producto — para mostrar el uso y decidir si se
    // puede borrar (product con sales asociadas → DB RESTRICT).
    supabase.from("sales").select("product_id"),
  ]);
  const sales = (salesRes.data ?? []) as unknown as SaleCountRow[];

  const salesByProductId = new Map<string, number>();
  for (const s of sales) {
    if (!s.product_id) continue;
    salesByProductId.set(
      s.product_id,
      (salesByProductId.get(s.product_id) ?? 0) + 1,
    );
  }

  const projectById = new Map(projects.map((p) => [p.id, p]));

  const filtered = products.filter((p) => {
    if (activeParam === "activos" && !p.active) return false;
    if (activeParam === "inactivos" && p.active) return false;
    if (projectFilter && p.project_id !== projectFilter) return false;
    return true;
  });

  const rows: ProductRowData[] = filtered.map((p) => {
    const project = projectById.get(p.project_id);
    return {
      id: p.id,
      projectId: p.project_id,
      projectName: project?.name ?? "—",
      name: p.name,
      description: (p as { description?: string | null }).description ?? null,
      salesCount: salesByProductId.get(p.id) ?? 0,
      active: p.active,
    };
  });

  const totalCount = rows.length;
  const totalActive = rows.filter((r) => r.active).length;
  const totalSalesShown = rows.reduce((a, r) => a + r.salesCount, 0);

  const projectsForDrawer: ProjectOption[] = projects.map((p) => ({
    id: p.id,
    name: p.name,
  }));

  const projectsWithProducts = new Set(products.map((p) => p.project_id));
  const projectPillOptions = [
    {
      label: "Todos los proyectos",
      href: buildHref({ state: activeParam, project: null }),
      active: projectFilter == null,
    },
    ...projects
      .filter((p) => projectsWithProducts.has(p.id))
      .map((p) => ({
        label: p.name,
        href: buildHref({ state: activeParam, project: p.id }),
        active: projectFilter === p.id,
      })),
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconOrg size={16} />}
        title="Productos"
        stats={[
          { l: "En la vista", v: fCount(totalCount) },
          { l: "Activos", v: fCount(totalActive) },
          { l: "Ventas asociadas", v: fCount(totalSalesShown) },
        ]}
      />

      <KgPageFilters
        activeCount={
          (activeParam !== "activos" ? 1 : 0) +
          (projectFilter != null ? 1 : 0)
        }
      >
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <KgParamPills
            ariaLabel="Filtrar por estado"
            options={ACTIVE_OPTIONS.map((o) => ({
              label: o.label,
              href: buildHref({ state: o.value, project: projectFilter }),
              active: activeParam === o.value,
            }))}
          />
          {projectPillOptions.length > 1 && (
            <KgParamPills
              ariaLabel="Filtrar por proyecto"
              options={projectPillOptions}
            />
          )}
        </div>
      </KgPageFilters>

      <Panel title="Catálogo de productos" pad={false}>
        <ProductosView
          rows={rows}
          totalCount={totalCount}
          projects={projectsForDrawer}
        />
      </Panel>
    </div>
  );
}

function parseActive(v: string | string[] | undefined): ActiveParam {
  if (typeof v !== "string") return "activos";
  const allowed: ActiveParam[] = ["activos", "inactivos", "todos"];
  return (allowed as string[]).includes(v) ? (v as ActiveParam) : "activos";
}

function buildHref(overrides: {
  state: ActiveParam;
  project: string | null;
}): string {
  const params = new URLSearchParams();
  if (overrides.state !== "activos") params.set("state", overrides.state);
  if (overrides.project) params.set("project", overrides.project);
  const qs = params.toString();
  return qs ? `/comercial/productos?${qs}` : "/comercial/productos";
}
