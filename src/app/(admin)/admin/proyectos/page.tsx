import type { Metadata } from "next";
import Link from "next/link";

import { ProjectDeleteButton } from "@/components/dashboard/admin/project-delete-button";
import { fmtDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

import { deleteProject } from "./actions";

export const metadata: Metadata = { title: "Proyectos" };

interface ProjectListRow {
  id: string;
  name: string;
  business_name: string | null;
  created_at: string;
}

export default async function ProjectsAdminPage() {
  // The (admin) layout already gated to superadmin. RLS lets superadmin read all.
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("id, name, business_name, created_at")
    .order("name", { ascending: true });

  const projects = (data ?? []) as ProjectListRow[];

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Proyectos</h1>
          <p className="mt-1 text-xs text-fg-subtle">{projects.length} total</p>
        </div>
        <Link
          href="/admin/proyectos/new"
          className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          + Nuevo proyecto
        </Link>
      </header>

      {projects.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-surface/40 p-8 text-center text-sm text-fg-muted">
          Sin proyectos cargados todavía. Creá el primero para que admins y
          clientes puedan empezar a trabajar.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-surface text-left text-xs uppercase tracking-wide text-fg-subtle">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Nombre
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Razón social
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Creado
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const deleteAction = deleteProject.bind(null, p.id);
                return (
                  <tr
                    key={p.id}
                    className="border-t border-border transition-colors hover:bg-surface"
                  >
                    <td className="px-4 py-3 font-medium text-fg">{p.name}</td>
                    <td className="px-4 py-3 text-fg-muted">
                      {p.business_name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-fg-muted">
                      {fmtDate(p.created_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-4">
                        <Link
                          href={`/admin/proyectos/${p.id}/edit`}
                          className="text-xs font-medium text-fg-muted hover:text-fg"
                        >
                          Editar
                        </Link>
                        <ProjectDeleteButton
                          projectName={p.name}
                          onConfirm={deleteAction}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
