import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getKgProjects } from "@/lib/kg/reference";

export const metadata: Metadata = { title: "Lanzamientos" };

/**
 * Módulo Lanzamientos = puerta al project picker.
 *
 * Antes vivía en `/` como home del shell viejo; ahora `/` es el Ejecutivo
 * Kingrow y el picker se movió acá dentro del módulo Lanzamientos. Al elegir
 * un proyecto se entra al ProjectShell (`/proyectos/[id]/*`).
 *
 * Estados:
 *   - 0 proyectos: empty state (típico: usuario recién invitado).
 *   - 1 proyecto: redirect directo — el flujo original de LaunchOS.
 *   - N proyectos: grid.
 */
export default async function LanzamientosPage() {
  const projects = await getKgProjects();

  if (projects.length === 0) {
    return (
      <section className="max-w-md space-y-3">
        <h1 className="kg-t2">Sin proyectos asignados</h1>
        <p className="text-sm" style={{ color: "var(--kg-text-2)" }}>
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
    <section className="space-y-6">
      <header>
        <h1 className="kg-t2">Proyectos activos</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--kg-text-2)" }}>
          Tenés acceso a {projects.length} proyectos. Entrá a cualquiera para
          ver su lanzamiento.
        </p>
      </header>

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((p) => (
          <li key={p.id}>
            <Link
              href={`/proyectos/${p.id}`}
              className="kg-glass kg-hov kg-focus block rounded-[14px] px-4 py-4 transition-colors"
              style={{ boxShadow: "var(--kg-shadow-amb)" }}
            >
              <div className="kg-t4" style={{ color: "var(--kg-text-1)" }}>
                {p.name}
              </div>
              <div
                className="kg-t7 mt-1"
                style={{ color: "var(--kg-text-3)" }}
              >
                Abrir →
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
