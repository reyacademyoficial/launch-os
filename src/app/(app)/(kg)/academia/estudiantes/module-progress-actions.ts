"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// Server actions para student_module_progress — marcado MANUAL de módulos.
//
// El progreso automático via tags GHL lo escribe `syncTagProgressForCourse`
// (Fase C). Este action es el complemento manual: el operador de academia
// tilda / destilda módulos desde la ficha del alumno.
//
// Semántica del toggle:
//   - completed=true  → upsert con completed_at=now(), source='manual'
//   - completed=false → DELETE de la fila (deja el módulo como pendiente)
//
// Si el módulo ya estaba marcado por GHL (source='ghl_tag') y el operador
// hace toggle=true, upsert lo re-marca como manual (overrides). El próximo
// pull de GHL puede volver a marcarlo como ghl_tag si el contacto sigue con
// la tag — es coherente porque el módulo sigue completo.
//
// Si el operador destilda un módulo marcado por GHL, se borra la fila. La
// próxima sync de GHL lo va a volver a insertar mientras la tag exista en
// HighLevel. El operador tiene que sacar la tag en GHL para persistir el
// destilde — lo cual es correcto: HighLevel es el source of truth cuando
// hay tag mapping.
// ═══════════════════════════════════════════════════════════════════════════

export type ToggleModuleProgressResult = { ok: true } | { error: string };

export async function toggleModuleCompletionAction(input: {
  readonly enrollmentId: string;
  readonly courseModuleId: string;
  readonly studentId: string;
  readonly completed: boolean;
}): Promise<ToggleModuleProgressResult> {
  await requireRole("superadmin", "admin", "coordinador");

  if (!input.enrollmentId) return { error: "Falta el id de la inscripción." };
  if (!input.courseModuleId) return { error: "Falta el id del módulo." };
  if (!input.studentId) return { error: "Falta el id del estudiante." };

  const supabase = await createClient();

  try {
    if (input.completed) {
      // Upsert marca el módulo como completo con source='manual'. Si ya
      // existía (por GHL o manual previo), pisa el source y actualiza el
      // completed_at.
      const payload = {
        enrollment_id: input.enrollmentId,
        course_module_id: input.courseModuleId,
        // project_id lo autocompleta el trigger — placeholder NOT NULL.
        project_id: input.enrollmentId,
        completed_at: new Date().toISOString(),
        source: "manual" as const,
        source_ref: null,
      } as unknown as never;

      const { error } = await supabase
        .from("student_module_progress")
        .upsert(payload, { onConflict: "enrollment_id,course_module_id" });

      if (error) return { error: error.message };
    } else {
      // Borrar la fila = módulo pendiente. Si mañana vuelve la tag en GHL,
      // el sync lo re-inserta.
      const { error } = await supabase
        .from("student_module_progress")
        .delete()
        .eq("enrollment_id", input.enrollmentId)
        .eq("course_module_id", input.courseModuleId);

      if (error) return { error: error.message };
    }

    revalidatePath(`/academia/estudiantes/${input.studentId}`);
    revalidatePath("/academia/estudiantes");
    revalidatePath("/academia");
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return { error: message };
  }
}
