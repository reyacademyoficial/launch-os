import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { listAccessibleProjects } from "@/lib/projects/list";

export const metadata: Metadata = { title: "Proyectos" };

/**
 * Project picker. Three states:
 *   - 0 projects: empty-state message (cliente without assignment).
 *   - 1 project: server-side redirect to that project's overview.
 *   - N projects: card grid; click → /proyectos/[id].
 *
 * The project list is fetched again here (also fetched by the layout for the
 * topbar switcher) — Next dedupes within the same request, so it's a single
 * round trip in practice.
 */
export default async function HomePage() {
  const projects = await listAccessibleProjects();

  if (projects.length === 0) {
    return (
      <section className="max-w-md space-y-3">
        <h1 className="text-2xl font-bold">Sin proyectos asignados</h1>
        <p className="text-sm text-fg-muted">
          Pedile a un superadmin que te asigne a un proyecto desde{" "}
          <code>/admin/usuarios</code>.
        </p>
      </section>
    );
  }

  if (projects.length === 1) {
    redirect(`/proyectos/${projects[0]!.id}`);
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
              href={`/proyectos/${p.id}`}
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
