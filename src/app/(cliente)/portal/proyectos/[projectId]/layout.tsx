import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * Per-project access guard del portal del cliente.
 *
 * Espejo del guard de `(app)/proyectos/[projectId]/layout.tsx`: si
 * `.from('projects').select('id').eq(...)` devuelve null → cliente no es
 * miembro (o el proyecto no existe). Redirect a `/portal` para evitar
 * disclosure de qué UUIDs existen.
 *
 * La RLS de `projects_select` ya filtra; este guard convierte ese "no veo
 * nada" en una redirección suave en lugar de una página vacía.
 */
export default async function ClientProjectLayout({
  children,
  params,
}: {
  readonly children: React.ReactNode;
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();

  if (!data) redirect("/portal");

  return <>{children}</>;
}
