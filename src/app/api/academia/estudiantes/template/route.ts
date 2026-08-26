import { NextResponse } from "next/server";

import ExcelJS from "exceljs";

import { createClient } from "@/lib/supabase/server";

/**
 * Plantilla xlsx para importar alumnos + inscripciones.
 *
 * Obligatorio: Nombre, Fecha de alta, Producto, Cohorte.
 * Opcional: Email, Teléfono, Vigencia hasta, Notas.
 *
 * `?projectId=<uuid>` opcional — si viene, la hoja "Referencia" solo lista
 * productos + cohortes de ese proyecto. Sin el query param, lista todas las
 * combinaciones de proyectos propios (menos útil, pero funciona).
 *
 * "Producto" y "Cohorte" en las filas se resuelven por nombre — el import
 * matchea contra combinación válida en el proyecto elegido en el drawer.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");

  const supabase = await createClient();

  // Traemos proyectos propios + sus courses activos + productos + cohortes.
  // Todo scoped al projectId si vino.
  const projectsQuery = supabase
    .from("projects")
    .select("id, name")
    .eq("ownership", "propia");
  const coursesQuery = supabase
    .from("courses")
    .select("id, product_id, project_id")
    .eq("active", true);

  const [projectsRes, coursesRes, productsRes, cohortsRes] = await Promise.all([
    projectId ? projectsQuery.eq("id", projectId) : projectsQuery,
    projectId ? coursesQuery.eq("project_id", projectId) : coursesQuery,
    supabase.from("products").select("id, name"),
    supabase.from("cohorts").select("id, name, course_id, project_id"),
  ]);

  const projects = (projectsRes.data ?? []) as unknown as ReadonlyArray<{
    id: string;
    name: string;
  }>;
  const courses = (coursesRes.data ?? []) as unknown as ReadonlyArray<{
    id: string;
    product_id: string;
    project_id: string;
  }>;
  const products = (productsRes.data ?? []) as unknown as ReadonlyArray<{
    id: string;
    name: string;
  }>;
  const cohorts = (cohortsRes.data ?? []) as unknown as ReadonlyArray<{
    id: string;
    name: string;
    course_id: string | null;
    project_id: string;
  }>;

  const productNameById = new Map<string, string>();
  for (const p of products) productNameById.set(p.id, p.name);
  const projectNameById = new Map<string, string>();
  for (const p of projects) projectNameById.set(p.id, p.name);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Kingrow";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Alumnos");
  sheet.columns = [
    { header: "Nombre", key: "name", width: 28 },
    { header: "Email", key: "email", width: 28 },
    { header: "Teléfono", key: "phone", width: 16 },
    { header: "Fecha de alta", key: "enrolled_at", width: 14 },
    { header: "Producto", key: "product", width: 24 },
    { header: "Cohorte", key: "cohort", width: 24 },
    { header: "Vigencia hasta", key: "expires_at", width: 14 },
    { header: "Notas", key: "notes", width: 30 },
  ];
  sheet.getRow(1).font = { bold: true };

  // Ejemplo — usa productos/cohortes reales del proyecto si hay para que el
  // operador copie el nombre exacto (mismos criterios de match del parser:
  // case-insensitive + sin acentos, pero mejor evitar sorpresas).
  const firstCourse = courses[0];
  const productExample =
    (firstCourse ? productNameById.get(firstCourse.product_id) : null) ??
    "Nombre del producto";
  const firstCohort = firstCourse
    ? cohorts.find((c) => c.course_id === firstCourse.id)
    : null;
  const cohortExample = firstCohort?.name ?? "Nombre de la cohorte";

  const example = sheet.addRow({
    name: "Ejemplo — Juan Pérez",
    email: "juan@example.com",
    phone: "+5491111111111",
    enrolled_at: new Date(),
    product: productExample,
    cohort: cohortExample,
    expires_at: "",
    notes: "Borrá esta fila antes de subir",
  });
  example.font = { italic: true, color: { argb: "FF888888" } };

  // Hoja de referencia: productos + cohortes disponibles.
  const refSheet = workbook.addWorksheet("Referencia");
  refSheet.columns = [
    { header: "Proyecto", key: "project", width: 24 },
    { header: "Producto", key: "product", width: 28 },
    { header: "Cohorte", key: "cohort", width: 28 },
  ];
  refSheet.getRow(1).font = { bold: true };

  for (const course of courses) {
    const productName = productNameById.get(course.product_id) ?? "—";
    const projectName = projectNameById.get(course.project_id) ?? "—";
    const cohortsForCourse = cohorts.filter((c) => c.course_id === course.id);
    if (cohortsForCourse.length === 0) {
      refSheet.addRow({
        project: projectName,
        product: productName,
        cohort: "(sin cohortes)",
      });
      continue;
    }
    for (const cohort of cohortsForCourse) {
      refSheet.addRow({
        project: projectName,
        product: productName,
        cohort: cohort.name,
      });
    }
  }

  const buf = await workbook.xlsx.writeBuffer();
  const filenameSlug = projects[0]
    ? projects[0].name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)
    : "academia";
  return new NextResponse(new Uint8Array(buf) as unknown as BodyInit, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="alumnos-plantilla-${filenameSlug}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
