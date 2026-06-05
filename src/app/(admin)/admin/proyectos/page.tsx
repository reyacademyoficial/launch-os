import type { Metadata } from "next";

export const metadata: Metadata = { title: "Proyectos" };

export default function ProjectsAdminPage() {
  return (
    <section>
      <h1 className="text-2xl font-bold">Proyectos</h1>
      <p className="mt-2 text-sm text-fg-muted">
        Alta de proyectos por superadmin — placeholder. Fase 8.
      </p>
    </section>
  );
}
