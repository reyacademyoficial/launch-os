import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ContextBar } from "@/components/kg/context-bar";
import { IconAca } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { StatusPill } from "@/components/kg/status-pill";
import {
  getCourseDropoff,
  getCourseModuleCompletionStats,
  getCourseOverallProgress,
} from "@/lib/academia/course-metrics";
import { getExternalApp } from "@/lib/academia/external-apps";
import { listModulesByCourse } from "@/lib/academia/modules";
import { getSessionProfile } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { listTeamMembersForProject } from "@/lib/team/list";

import { MetricasTab } from "./metricas-tab";
import { ModulesTab, type ModuleRowData } from "./modules-tab";
import { OpenExternalAppButton } from "./open-external-app-button";
import { SistemasTab, type SystemRowData, type TeamMemberOption } from "./sistemas-tab";

export const metadata: Metadata = { title: "Curso · Academia" };

interface CourseDbRow {
  readonly id: string;
  readonly product_id: string;
  readonly project_id: string;
  readonly duration_hours: number | null;
  readonly modules_count: number | null;
  readonly active: boolean;
  readonly has_systems: boolean;
  readonly progress_source: string;
  readonly external_app_id: string | null;
}

interface ProductDbRow {
  readonly id: string;
  readonly name: string;
}

interface ProjectDbRow {
  readonly id: string;
  readonly name: string;
}

interface AcademiaSystemDbRow {
  readonly id: string;
  readonly name: string;
  readonly color: string | null;
  readonly expert_team_member_id: string | null;
  readonly active: boolean;
}

interface CohortDbRow {
  readonly id: string;
  readonly name: string;
}

export default async function CoursePage({
  params,
}: {
  readonly params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const supabase = await createClient();

  const courseRes = await supabase
    .from("courses")
    .select(
      "id, product_id, project_id, duration_hours, modules_count, active, has_systems, progress_source, external_app_id",
    )
    .eq("id", courseId)
    .maybeSingle();

  const course = courseRes.data as CourseDbRow | null;
  if (!course) notFound();

  const [productRes, projectRes, cohortsRes, systemsRes] = await Promise.all([
    supabase
      .from("products")
      .select("id, name")
      .eq("id", course.product_id)
      .maybeSingle(),
    supabase
      .from("projects")
      .select("id, name")
      .eq("id", course.project_id)
      .maybeSingle(),
    supabase.from("cohorts").select("id, name").eq("course_id", courseId),
    supabase
      .from("academia_systems")
      .select("id, name, color, expert_team_member_id, active")
      .eq("course_id", courseId)
      .order("active", { ascending: false })
      .order("name", { ascending: true }),
  ]);

  const product = productRes.data as ProductDbRow | null;
  const project = projectRes.data as ProjectDbRow | null;
  const cohorts = (cohortsRes.data ?? []) as unknown as CohortDbRow[];
  const systems =
    (systemsRes.data ?? []) as unknown as AcademiaSystemDbRow[];

  const teamMembers = course.has_systems
    ? await listTeamMembersForProject(course.project_id)
    : [];

  // App externa asociada (Fase G · 0153). Solo cargamos si el curso está
  // enlazado. RLS filtra por proyecto — si no hay acceso, app queda null.
  const externalApp = course.external_app_id
    ? await getExternalApp(course.external_app_id)
    : null;
  const showExternalAppButton =
    externalApp != null && externalApp.active === true;

  // Módulos + mappings de tags GHL + métricas. Solo cargamos si el curso los
  // muestra (progress_source='ghl_tags'); en otros casos son irrelevantes en
  // esta UI.
  const showModules = course.progress_source === "ghl_tags";
  const modules = showModules ? await listModulesByCourse(courseId) : [];

  const [completionStats, dropoffStats, overallProgress] = showModules
    ? await Promise.all([
        getCourseModuleCompletionStats(courseId),
        getCourseDropoff(courseId),
        getCourseOverallProgress(courseId),
      ])
    : [
        [] as Awaited<ReturnType<typeof getCourseModuleCompletionStats>>,
        [] as Awaited<ReturnType<typeof getCourseDropoff>>,
        {
          avg_completion_percent: 0,
          total_students: 0,
          fully_completed_students: 0,
        } as Awaited<ReturnType<typeof getCourseOverallProgress>>,
      ];

  const moduleIds = modules.map((m) => m.id);
  const tagMappingsRes =
    showModules && moduleIds.length > 0
      ? await supabase
          .from("module_ghl_tag_mappings")
          .select("course_module_id, ghl_tag")
          .in("course_module_id", moduleIds)
      : { data: [] as { course_module_id: string; ghl_tag: string }[] };
  const tagByModule = new Map<string, string>();
  for (const row of (tagMappingsRes.data ?? []) as unknown as {
    course_module_id: string;
    ghl_tag: string;
  }[]) {
    tagByModule.set(row.course_module_id, row.ghl_tag);
  }

  const moduleRows: ModuleRowData[] = modules.map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    orderIndex: m.order_index,
    ghlTag: tagByModule.get(m.id) ?? null,
  }));

  // canEdit para los módulos: admin/coordinador/superadmin. El server action
  // igual gatea; esto es solo la UI.
  const profile = await getSessionProfile();
  const canEditModules =
    profile != null &&
    (profile.role === "admin" ||
      profile.role === "coordinador" ||
      profile.role === "superadmin" ||
      profile.role === "dev" ||
      profile.isDevPrivileged);

  const systemRows: SystemRowData[] = systems.map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
    expertTeamMemberId: s.expert_team_member_id,
    active: s.active,
  }));

  const teamOptions: TeamMemberOption[] = teamMembers.map((tm) => ({
    id: tm.id,
    name: tm.name,
    role: tm.role,
    active: tm.active,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconAca size={16} />}
        title={product?.name ?? "Curso"}
        stats={[
          { l: "Estado", v: course.active ? "Activo" : "Archivado" },
          { l: "Cohortes", v: String(cohorts.length) },
          { l: "Sistemas", v: String(systemRows.length) },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Panel title="Datos del curso">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <FieldRow label="Producto" value={product?.name ?? "—"} />
            <FieldRow label="Proyecto" value={project?.name ?? "—"} />
            <FieldRow
              label="Duración"
              value={
                course.duration_hours != null
                  ? `${course.duration_hours} h`
                  : "—"
              }
            />
            <FieldRow
              label="Módulos"
              value={
                course.modules_count != null
                  ? String(course.modules_count)
                  : "—"
              }
            />
            <FieldRow
              label="Fuente de progreso"
              value={course.progress_source}
            />
            <FieldRow
              label="Estado"
              value={
                <StatusPill
                  text={course.active ? "Activo" : "Archivado"}
                  tone={
                    course.active
                      ? "var(--kg-positive-500)"
                      : "var(--kg-neutral-500)"
                  }
                />
              }
            />
            {showExternalAppButton && externalApp && (
              <div style={{ marginTop: 4 }}>
                <FieldRow
                  label="App externa"
                  value={
                    <OpenExternalAppButton
                      courseId={course.id}
                      appName={externalApp.name}
                    />
                  }
                />
              </div>
            )}
            <div style={{ marginTop: 6 }}>
              <Link
                href="/academia/cursos"
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
                ← Volver a Cursos
              </Link>
            </div>
          </div>
        </Panel>

        {course.has_systems && (
          <Panel title="Sistemas">
            <SistemasTab
              courseId={course.id}
              rows={systemRows}
              teamMembers={teamOptions}
            />
          </Panel>
        )}
      </div>

      {showModules && (
        <Panel title="Módulos (progreso vía tags GHL)">
          <ModulesTab
            courseId={course.id}
            modules={moduleRows}
            canEdit={canEditModules}
            showTagCol={true}
          />
        </Panel>
      )}

      {showModules && (
        <Panel title="Métricas">
          <MetricasTab
            completions={completionStats}
            dropoff={dropoffStats}
            overall={overallProgress}
          />
        </Panel>
      )}
    </div>
  );
}

function FieldRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: React.ReactNode;
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
          lineHeight: 1.4,
        }}
      >
        {value}
      </div>
    </div>
  );
}
