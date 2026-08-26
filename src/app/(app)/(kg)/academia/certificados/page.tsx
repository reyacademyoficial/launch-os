import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconAca } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";
import { createClient } from "@/lib/supabase/server";

import { PersistentFilterSync } from "../_shared/persistent-filters";
import type {
  CourseOptionForCert,
  StudentOptionForCert,
} from "./certificate-form-drawer";
import {
  CertificadosView,
  type CertificateRowData,
} from "./certificados-view";
import { NewCertificateButton } from "./new-certificate-button";

export const metadata: Metadata = { title: "Certificados · Academia" };

interface CertDbRow {
  readonly id: string;
  readonly student_id: string;
  readonly course_id: string;
  readonly project_id: string;
  readonly code: string | null;
  readonly issued_at: string;
  readonly url: string | null;
  readonly notes: string | null;
}

interface StudentDbRow {
  readonly id: string;
  readonly name: string;
  readonly project_id: string;
}

interface CourseDbRow {
  readonly id: string;
  readonly product_id: string;
  readonly project_id: string;
}

interface ProductDbRow {
  readonly id: string;
  readonly name: string;
}

interface ProjectDbRow {
  readonly id: string;
  readonly name: string;
  readonly ownership: string;
}

export default async function CertificadosPage() {
  const supabase = await createClient();

  const [certsRes, studentsRes, coursesRes, productsRes, projectsRes] =
    await Promise.all([
      supabase
        .from("certificates")
        .select(
          "id, student_id, course_id, project_id, code, issued_at, url, notes",
        )
        .order("issued_at", { ascending: false }),
      supabase
        .from("students")
        .select("id, name, project_id"),
      supabase
        .from("courses")
        .select("id, product_id, project_id"),
      supabase.from("products").select("id, name"),
      supabase
        .from("projects")
        .select("id, name, ownership")
        .eq("ownership", "propia"),
    ]);

  const certRows = (certsRes.data ?? []) as unknown as CertDbRow[];
  const studentRows = (studentsRes.data ?? []) as unknown as StudentDbRow[];
  const courseRows = (coursesRes.data ?? []) as unknown as CourseDbRow[];
  const productRows = (productsRes.data ?? []) as unknown as ProductDbRow[];
  const propiaProjects =
    (projectsRes.data ?? []) as unknown as ProjectDbRow[];

  const productNameById = new Map<string, string>();
  for (const p of productRows) productNameById.set(p.id, p.name);
  const projectNameById = new Map<string, string>();
  for (const p of propiaProjects) projectNameById.set(p.id, p.name);
  const studentById = new Map<string, StudentDbRow>();
  for (const s of studentRows) studentById.set(s.id, s);
  const courseById = new Map<string, CourseDbRow>();
  for (const c of courseRows) courseById.set(c.id, c);

  const certificates: CertificateRowData[] = certRows.map((c) => {
    const student = studentById.get(c.student_id);
    const course = courseById.get(c.course_id);
    return {
      id: c.id,
      studentId: c.student_id,
      studentName: student?.name ?? "—",
      courseId: c.course_id,
      courseName: course
        ? productNameById.get(course.product_id) ?? "—"
        : "—",
      projectName: projectNameById.get(c.project_id) ?? "—",
      code: c.code,
      issuedAt: c.issued_at,
      url: c.url,
      notes: c.notes,
    };
  });

  const uniqueStudentsCertified = new Set(certRows.map((c) => c.student_id))
    .size;

  // Options para el drawer: solo estudiantes/cursos de proyectos propios.
  // (RLS ya filtra por acceso pero acá restringimos a propia para no
  // ofrecer combinaciones que el guard va a rebotar.)
  const propiaProjectIds = new Set(propiaProjects.map((p) => p.id));
  const studentOptions: StudentOptionForCert[] = studentRows
    .filter((s) => propiaProjectIds.has(s.project_id))
    .map((s) => ({
      id: s.id,
      name: s.name,
      projectId: s.project_id,
      projectName: projectNameById.get(s.project_id) ?? "—",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const courseOptions: CourseOptionForCert[] = courseRows
    .filter((c) => propiaProjectIds.has(c.project_id))
    .map((c) => ({
      id: c.id,
      productName: productNameById.get(c.product_id) ?? "—",
      projectId: c.project_id,
    }))
    .sort((a, b) => a.productName.localeCompare(b.productName));

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <ContextBar
        icon={<IconAca size={16} />}
        title="Certificados"
        stats={[
          { l: "Emitidos", v: fCount(certificates.length) },
          { l: "Estudiantes certificados", v: fCount(uniqueStudentsCertified) },
        ]}
      />
      <PersistentFilterSync storageKey="academia:filters:certificados" />

      <Panel
        title="Certificados emitidos"
        pad={false}
        fillHeight
        actions={
          <NewCertificateButton
            students={studentOptions}
            courses={courseOptions}
          />
        }
      >
        <CertificadosView
          certificates={certificates}
          students={studentOptions}
          courses={courseOptions}
        />
      </Panel>
    </div>
  );
}
