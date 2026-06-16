import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { listAccessibleProjects } from "@/lib/projects/list";

export const metadata: Metadata = { title: "Portal" };

/**
 * Picker del portal. Mismo modelo que la home del shell del equipo: si el
 * cliente está asignado a un solo proyecto, salteamos el picker y entramos
 * directo a su overview ejecutivo.
 */
export default async function ClientPortalHome() {
  const projects = await listAccessibleProjects();

  if (projects.length === 0) {
    return (
      <section className="max-w-md space-y-3">
        <h1 className="text-2xl font-bold">Sin proyectos asignados</h1>
        <p className="text-sm text-fg-muted">
          Pedile al equipo de Growins que te asignen a un proyecto desde su
          panel de administración.
        </p>
      </section>
    );
  }

  if (projects.length === 1) {
    redirect(`/portal/proyectos/${projects[0]!.id}`);
  }

  return (
    <section className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Elegí un proyecto</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Tenés acceso a {projects.length} proyectos.
        </p>
      </header>

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {projects.map((p) => (
          <li key={p.id}>
            <Link
              href={`/portal/proyectos/${p.id}`}
              className="block rounded-md border border-border bg-surface px-4 py-4 transition-colors hover:border-accent hover:bg-bg-elevated"
            >
              <div className="font-medium text-fg">{p.name}</div>
              <div className="mt-1 text-xs text-fg-subtle">Abrir →</div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
