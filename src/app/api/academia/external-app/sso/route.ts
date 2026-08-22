import { NextResponse } from "next/server";

import { getExternalApp } from "@/lib/academia/external-apps";
import { generateSsoUrl } from "@/lib/academia/external-app-sso";
import { getSessionProfile } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/academia/external-app/sso?courseId=<uuid>[&redirect=1]
 *
 * Devuelve `{ url }` con la URL de SSO a la app externa asociada al curso, o
 * hace 307 si `?redirect=1`. Usado por el botón "Abrir app Nitro" del detalle
 * del curso.
 *
 * Flujo:
 *   1) Sesión requerida (getSessionProfile). Si no hay sesión → 401.
 *   2) courseId requerido y curso resoluble.
 *   3) course.external_app_id no null (curso no está enlazado a ninguna app).
 *   4) Match del email del user contra students.email del mismo proyecto —
 *      el user de Kingrow no es necesariamente un student, pero para SSO
 *      necesitamos su email como student en Nitro. Si no hay match → 403.
 *   5) Genera la URL con generateSsoUrl según la strategy de la app.
 *
 * Devolvemos JSON por default (el cliente lo consume con fetch y hace
 * `window.open(url)`) — es más flexible que un 307 porque:
 *   - permite mostrar loading state en el botón
 *   - permite manejar errores (403, 404, etc.) inline
 *   - abrir en nueva pestaña require llamada JS de todos modos
 *
 * Con `?redirect=1` respondemos 307 (útil para links directos o testing).
 */

interface CourseRow {
  readonly id: string;
  readonly project_id: string;
  readonly external_app_id: string | null;
}

interface StudentMatch {
  readonly id: string;
  readonly name: string;
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const courseId = url.searchParams.get("courseId");
  const shouldRedirect = url.searchParams.get("redirect") === "1";

  if (!courseId) {
    return NextResponse.json(
      { error: "Falta courseId en la query." },
      { status: 400 },
    );
  }

  const profile = await getSessionProfile();
  if (!profile) {
    return NextResponse.json(
      { error: "No autenticado." },
      { status: 401 },
    );
  }
  if (!profile.email) {
    return NextResponse.json(
      { error: "Tu usuario no tiene email registrado. Contactá al admin." },
      { status: 403 },
    );
  }

  const supabase = await createClient();
  const courseRes = await supabase
    .from("courses")
    .select("id, project_id, external_app_id")
    .eq("id", courseId)
    .maybeSingle();
  const course = courseRes.data as CourseRow | null;
  if (!course) {
    return NextResponse.json(
      { error: "Curso no encontrado." },
      { status: 404 },
    );
  }
  if (!course.external_app_id) {
    return NextResponse.json(
      { error: "Este curso no tiene app externa asociada." },
      { status: 404 },
    );
  }

  // Match student por email en el mismo proyecto — case-insensitive.
  const emailLower = profile.email.toLowerCase();
  const studentRes = await supabase
    .from("students")
    .select("id, name")
    .eq("project_id", course.project_id)
    .ilike("email", emailLower)
    .maybeSingle();
  const student = studentRes.data as StudentMatch | null;
  if (!student) {
    return NextResponse.json(
      {
        error:
          "Tu email no coincide con ningún alumno de este proyecto. La app externa solo permite acceso a alumnos inscriptos.",
      },
      { status: 403 },
    );
  }

  // Sanity: la app tiene que ser del mismo proyecto que el curso. RLS ya
  // lo garantiza (has_project_access sobre external_apps) pero lo chequeamos
  // explícito para dar un mensaje claro.
  const app = await getExternalApp(course.external_app_id);
  if (!app) {
    return NextResponse.json(
      { error: "La app externa asociada al curso no existe o no es visible." },
      { status: 404 },
    );
  }
  if (app.project_id !== course.project_id) {
    return NextResponse.json(
      {
        error:
          "La app externa pertenece a otro proyecto. Revisá la configuración del curso.",
      },
      { status: 409 },
    );
  }

  let ssoUrl: string;
  try {
    const result = await generateSsoUrl(app.id, profile.email, course.id);
    ssoUrl = result.url;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json(
      { error: `No se pudo generar el SSO: ${message}` },
      { status: 500 },
    );
  }

  if (shouldRedirect) {
    return NextResponse.redirect(ssoUrl, { status: 307 });
  }

  return NextResponse.json(
    { url: ssoUrl },
    { headers: { "Cache-Control": "no-store" } },
  );
}
