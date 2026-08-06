import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ContextBar } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
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

export const metadata: Metadata = { title: "Generación · Academia" };

type Status = "planned" | "active" | "finished" | "cancelled";

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

const STATUS_LABEL: Record<Status, string> = {
  planned: "Planeada",
  active: "Activa",
  finished: "Terminada",
  cancelled: "Cancelada",
};

const STATUS_TONE: Record<Status, string> = {
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
      .select("id", { count: "exact", head: true })
      .eq("cohort_id", cohortId),
    supabase
      .from("classes")
      .select("id", { count: "exact", head: true })
      .eq("cohort_id", cohortId),
    supabase
      .from("exams")
      .select("id", { count: "exact", head: true })
      .eq("cohort_id", cohortId),
  ]);

  const cohort = cohortRes.data as CohortDbRow | null;
  if (!cohort) notFound();

  const propiaProjects =
    (projectsRes.data ?? []) as unknown as ProjectDbRow[];
  const activeCourses =
    (coursesRes.data ?? []) as unknown as CourseDbRow[];
  const allProducts = (productsRes.data ?? []) as unknown as ProductDbRow[];

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

  const enrollmentsCount = enrollmentsRes.count ?? 0;
  const classesCount = classesRes.count ?? 0;
  const examsCount = examsRes.count ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconAca size={16} />}
        title={cohort.name}
        stats={[
          { l: "Estado", v: STATUS_LABEL[cohort.status] },
          { l: "Inscriptos", v: String(enrollmentsCount) },
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
          <EmptyState
            icon={<IconAca size={22} />}
            title="Sub-sección en construcción"
            hint="En el próximo commit acá van los estudiantes inscriptos + botón para inscribir con dropdown Origen (venta LaunchOS auto-fill o carga manual)."
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
          <EmptyState
            icon={<IconAca size={22} />}
            title="Sub-sección en construcción"
            hint="Programación de clases + carga masiva de asistencia por clase (una clase, N alumnos marcados de una)."
          />
        </Panel>
        <Panel title="Exámenes">
          <EmptyState
            icon={<IconAca size={22} />}
            title="Sub-sección en construcción"
            hint="Registro de exámenes por estudiante con score 0-100 y passed opcional (null = pendiente de corrección)."
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
