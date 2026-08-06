import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";

import { ContextBar } from "@/components/kg/context-bar";
import { IconOps } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { StatusPill } from "@/components/kg/status-pill";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Proceso · Operaciones" };

interface ProcessDbRow {
  readonly id: string;
  readonly title: string;
  readonly slug: string | null;
  readonly content_md: string;
  readonly category: string | null;
  readonly version: number;
  readonly active: boolean;
  readonly updated_at: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Ficha del proceso — render del content_md como Markdown.
//
// Sin toolbar de edición inline por ahora — editar se hace desde el
// listado con el drawer. En un commit futuro se puede agregar un
// "Editar" botón en la ficha que reusa el drawer.
// ═══════════════════════════════════════════════════════════════════════════

export default async function ProcessFichaPage({
  params,
}: {
  readonly params: Promise<{ processId: string }>;
}) {
  const { processId } = await params;

  const supabase = await createClient();
  const { data } = await supabase
    .from("processes")
    .select(
      "id, title, slug, content_md, category, version, active, updated_at",
    )
    .eq("id", processId)
    .maybeSingle();

  const process = data as ProcessDbRow | null;
  if (!process) notFound();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconOps size={16} />}
        title={process.title}
        stats={[
          { l: "Versión", v: `v${process.version}` },
          { l: "Categoría", v: process.category ?? "—" },
          {
            l: "Estado",
            v: process.active ? "Activo" : "Archivado",
          },
        ]}
      />

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Link
          href="/operaciones/procesos"
          className="kg-focus"
          style={{
            padding: "6px 12px",
            borderRadius: 999,
            background: "transparent",
            border: "1px solid var(--kg-border-subtle)",
            color: "var(--kg-text-2)",
            fontSize: 11,
            fontWeight: 700,
            textDecoration: "none",
          }}
        >
          ← Volver a procesos
        </Link>
        {process.slug && (
          <span
            className="kg-t7"
            style={{
              color: "var(--kg-text-3)",
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
            }}
          >
            slug: /{process.slug}
          </span>
        )}
        {!process.active && (
          <StatusPill text="Archivado" tone="var(--kg-neutral-500)" />
        )}
      </div>

      <Panel title="Contenido">
        {process.content_md.trim().length === 0 ? (
          <div
            className="kg-t6"
            style={{
              color: "var(--kg-text-3)",
              padding: "24px 0",
              textAlign: "center",
              fontStyle: "italic",
            }}
          >
            Este proceso aún no tiene contenido. Editalo desde el listado.
          </div>
        ) : (
          <div
            className="kg-markdown"
            style={{
              color: "var(--kg-text-1)",
              fontSize: 14,
              lineHeight: 1.65,
            }}
          >
            <ReactMarkdown>{process.content_md}</ReactMarkdown>
          </div>
        )}
      </Panel>
    </div>
  );
}
