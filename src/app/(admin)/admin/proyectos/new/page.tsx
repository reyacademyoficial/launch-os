import type { Metadata } from "next";

import { ProjectForm } from "@/components/dashboard/admin/project-form";

import { createProject } from "../actions";

export const metadata: Metadata = { title: "Nuevo proyecto" };

export default function NewProjectPage() {
  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Nuevo proyecto</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Después de crearlo lo vas a poder asignar a admins y clientes desde{" "}
          <code>/admin/usuarios</code>.
        </p>
      </header>

      <ProjectForm action={createProject} submitLabel="Crear proyecto" />
    </section>
  );
}
