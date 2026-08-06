import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ContextBar } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import { IconOps } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Proyecto interno · Operaciones" };

interface InternalProjectDbRow {
  readonly id: string;
  readonly name: string;
  readonly status: string;
}

/**
 * Ficha del proyecto interno — placeholder de andamio.
 *
 * En el commit siguiente: datos del proyecto (name, description, owner,
 * fechas, notes), sub-secciones de Tareas + Bloqueadores + Checklists +
 * Time entries del proyecto, y KPIs (tareas done vs pendientes, horas
 * dedicadas totales).
 */
export default async function InternalProjectFichaPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const supabase = await createClient();
  const { data } = await supabase
    .from("internal_projects")
    .select("id, name, status")
    .eq("id", projectId)
    .maybeSingle();

  const project = data as InternalProjectDbRow | null;
  if (!project) notFound();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconOps size={16} />}
        title={project.name}
        stats={[
          { l: "Estado", v: project.status },
          { l: "Tareas abiertas", v: "—" },
          { l: "Bloqueadores", v: "—" },
          { l: "Horas dedicadas", v: "—" },
        ]}
      />
      <Panel title="Overview del proyecto">
        <EmptyState
          icon={<IconOps size={22} />}
          title="Ficha en construcción"
          hint={`En próximos commits acá va: datos completos, sub-secciones con tareas/bloqueadores/checklists/time entries de "${project.name}", y ranking de personas que trabajaron.`}
          actions={
            <Link
              href="/operaciones/proyectos"
              className="kg-focus"
              style={{
                padding: "8px 16px",
                borderRadius: 999,
                background: "transparent",
                border: "1px solid var(--kg-border-subtle)",
                color: "var(--kg-text-2)",
                fontSize: 12,
                fontWeight: 700,
                textDecoration: "none",
              }}
            >
              ← Volver al listado
            </Link>
          }
        />
      </Panel>
    </div>
  );
}
