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
  ProjectOptionForStudent,
  StudentInitial,
} from "../student-form-drawer";
import { EditStudentButton } from "./edit-student-button";

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

  const [studentRes, projectsRes, enrollmentsRes, attendanceRes, examsRes, certsRes] =
    await Promise.all([
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
        .select("id", { count: "exact", head: true })
        .eq("student_id", studentId),
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
        .select("id", { count: "exact", head: true })
        .eq("student_id", studentId),
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

  const enrollmentsCount = enrollmentsRes.count ?? 0;
  const attendanceCount = attendanceRes.count ?? 0;
  const examsCount = examsRes.count ?? 0;
  const certsCount = certsRes.count ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconAca size={16} />}
        title={student.name}
        stats={[
          { l: "Estado", v: STATUS_LABEL[student.status] },
          { l: "Generaciones", v: String(enrollmentsCount) },
          { l: "Asistencias", v: String(attendanceCount) },
          { l: "Certificados", v: String(certsCount) },
        ]}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2fr)",
          gap: 16,
        }}
      >
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
          <EmptyState
            icon={<IconAca size={22} />}
            title="Sin generaciones asignadas"
            hint="En el próximo commit acá va la lista de inscripciones del estudiante con la generación, curso, fecha de inscripción, progreso y estado (active/completed/dropped/suspended). Además del botón para inscribirlo a una nueva generación con o sin vínculo a venta."
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
          <EmptyState
            icon={<IconAca size={22} />}
            title="Sub-sección en construcción"
            hint={`${certsCount} certificados emitidos.`}
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
