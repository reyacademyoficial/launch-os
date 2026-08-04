import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ContextBar } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import { IconCli } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Cliente · Clientes" };

interface ProjectRow {
  readonly id: string;
  readonly name: string;
}

/**
 * Ficha del cliente gestionado — placeholder de andamio.
 *
 * En el commit siguiente: overview (health + LTV + estado + notas) +
 * sub-tabs internos (tickets/renovaciones/upsells/nps filtrados por
 * projectId). Alimentado por selectores de src/lib/clients/ pasando las
 * rows filtradas para este project.
 *
 * Nota sobre el layout: hereda las tabs globales del módulo Clientes
 * (Dashboard aparece marcado al estar en un sub-path). Es consciente — el
 * botón "Volver al listado" abajo compensa la ambigüedad hasta que valga
 * la pena separar rutas con un route group.
 */
export default async function ClienteFichaPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .maybeSingle();

  const project = data as ProjectRow | null;
  if (!project) notFound();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconCli size={16} />}
        title={project.name}
        stats={[
          { l: "Estado", v: "—" },
          { l: "Health", v: "—" },
          { l: "LTV", v: "—" },
          { l: "Último contacto", v: "—" },
        ]}
      />
      <Panel title="Overview del cliente">
        <EmptyState
          icon={<IconCli size={22} />}
          title="Ficha en construcción"
          hint="Acá va: health score (fórmula compuesta NPS 40% + contacto 30% + tickets urgentes 30%), LTV desglosado, estado de la relación, notas, y sub-tabs con tickets/renovaciones/upsells/NPS del cliente."
          actions={
            <Link
              href="/clientes"
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
